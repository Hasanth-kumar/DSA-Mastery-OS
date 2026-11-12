import {
  createObsidianVault,
  slugifyProblemName,
  type ObsidianNoteFile,
  type ObsidianVault,
} from "@dsa/integrations";
import type { AppConfig } from "@dsa/shared";
import type { NoteRepository, NoteRow } from "../repositories/NoteRepository.js";
import type { ProblemRepository, ProblemRow } from "../repositories/ProblemRepository.js";
import type { TopicRepository } from "../repositories/TopicRepository.js";

export interface NoteScanResult {
  scanned: number;
  matched: number;
  unmatched: number;
}

export interface NoteTemplateResult {
  created: boolean;
  path?: string;
  reason?: string;
}

/**
 * Read-only Obsidian vault ingestion (Phase 2). Watches the vault, matches
 * notes to problems (frontmatter slug first, filename fallback), and mirrors
 * metadata + content into SQLite. Existing note content is never rewritten.
 * Writes: creating brand-new template files (2.4), and appending a dated
 * takeaway line to the end of an existing note (P6.2, `takeawayField`).
 */
export class ObsidianNoteService {
  private readonly vault: ObsidianVault | null;
  private watching = false;

  constructor(
    config: AppConfig,
    private readonly noteRepo: NoteRepository,
    private readonly problemRepo: ProblemRepository,
    private readonly topicRepo: TopicRepository,
    private readonly onIngest?: () => void,
  ) {
    this.vault = config.obsidian.vaultPath
      ? createObsidianVault(config.obsidian.vaultPath)
      : null;
  }

  isConfigured(): boolean {
    return this.vault?.isConfigured() ?? false;
  }

  /** Full vault scan — run on startup and on each sync. */
  scanVault(): NoteScanResult {
    if (!this.vault?.isConfigured()) {
      return { scanned: 0, matched: 0, unmatched: 0 };
    }

    const noteFiles = this.vault.scan();
    const problems = this.problemRepo.findAll();
    let matched = 0;

    const livePaths = new Set<string>();
    for (const note of noteFiles) {
      livePaths.add(note.path);
      if (this.ingestNote(note, problems)) matched += 1;
    }

    // Drop rows whose files vanished while the watcher was down.
    for (const row of this.noteRepo.findAll()) {
      if (!livePaths.has(row.path)) {
        this.noteRepo.deleteByPath(row.path);
      }
    }

    return {
      scanned: noteFiles.length,
      matched,
      unmatched: noteFiles.length - matched,
    };
  }

  startWatching(onError?: (err: unknown) => void): void {
    if (!this.vault?.isConfigured() || this.watching) return;
    this.watching = true;

    this.vault.startWatching({
      onChanged: (note) => {
        this.ingestNote(note, this.problemRepo.findAll());
        this.onIngest?.();
      },
      onRemoved: (path) => {
        this.noteRepo.deleteByPath(path);
        this.onIngest?.();
      },
      onError,
    });
  }

  async stopWatching(): Promise<void> {
    await this.vault?.stopWatching();
    this.watching = false;
  }

  getNoteForProblem(problemId: string): NoteRow | null {
    return this.noteRepo.findByProblemId(problemId);
  }

  getNotesForTopic(topicId: string): NoteRow[] {
    return this.noteRepo.findByTopicId(topicId);
  }

  /**
   * Generate a pre-filled note template for a just-logged problem (2.4).
   * New files only — never overwrites. Takeaways saved before the note
   * existed (P6.2) are written into its `## Takeaways` section.
   */
  createTemplateForProblem(
    problemId: string,
    takeaways: { date: Date; text: string }[] = [],
  ): NoteTemplateResult {
    if (!this.vault?.isConfigured()) {
      return { created: false, reason: "Obsidian vault not configured" };
    }
    const problem = this.problemRepo.findById(problemId);
    if (!problem) {
      return { created: false, reason: "Problem not found" };
    }
    const linked = this.noteRepo.findByProblemId(problemId);
    if (linked) {
      if (noteBelongsToProblem(linked, problem)) {
        return { created: false, reason: "A note for this problem already exists" };
      }
      // A pattern write-up can share the problem's opening words ("Binary Search
      // + Prefix Sum - Basic Stuff"). Drop that link so it cannot block a real note.
      this.noteRepo.upsertByPath({
        path: linked.path,
        title: linked.title,
        problemId: null,
        topicId: null,
        frontmatter: storedFrontmatter(linked.frontmatter),
        content: linked.content ?? undefined,
        contentHash: linked.contentHash ?? undefined,
        matchedBy: null,
      });
    }

    const slug = slugifyProblemName(problem.name);
    const topic = problem.topicId ? this.topicRepo.findById(problem.topicId) : null;
    const topicName = topic?.name ?? "";
    const content = `---
problem: ${slug}
topic: ${topicName}
difficulty: ${(problem.difficulty ?? "medium").toLowerCase()}
---

# ${problem.name}

## Approach

## Mistake

## Key insight
${
  takeaways.length > 0
    ? `\n## Takeaways\n${takeaways.map((t) => `${takeawayLine(t.text, t.date)}\n`).join("")}`
    : ""
}`;

    const topicDir = topicName ? this.vault.resolveTopicDirectory(topicName) : undefined;
    const relativePath = this.vault.createNoteFile(problem.name, content, topicDir);
    if (!relativePath) {
      return { created: false, reason: "A file with this name already exists in the vault" };
    }

    const written = this.vault.readNote(relativePath);
    if (written) {
      this.ingestNote(written, this.problemRepo.findAll());
    }
    return { created: true, path: relativePath };
  }

  /**
   * P6.2: append a dated takeaway line to the problem's EXISTING note, under a
   * `## Takeaways` heading at the end of the file. Append-only: nothing already
   * in the note is changed. When there is no note, nothing is written here:
   * the takeaway stays on the attempt and goes into the note once it is created.
   */
  appendTakeaway(problemId: string, takeaway: string, date: Date): boolean {
    if (!this.vault?.isConfigured()) return false;
    const note = this.noteRepo.findByProblemId(problemId);
    if (!note) return false;
    const current = this.vault.readNote(note.path);
    if (!current) return false;
    const line = takeawayLine(takeaway, date);
    const headings = current.content.match(/^## .*$/gm) ?? [];
    const underTakeaways = headings[headings.length - 1]?.trim() === "## Takeaways";
    const text = `${current.content.endsWith("\n") ? "" : "\n"}${
      underTakeaways ? "" : "\n## Takeaways\n"
    }${line}\n`;
    if (!this.vault.appendToNote(note.path, text)) return false;
    const written = this.vault.readNote(note.path);
    if (written) this.ingestNote(written, this.problemRepo.findAll());
    return true;
  }

  /** Frontmatter `problem:` slug wins; fallback to filename ↔ problem-name matching. */
  private ingestNote(note: ObsidianNoteFile, problems: ProblemRow[]): boolean {
    let matchedProblem: ProblemRow | null = null;
    let matchedBy: "frontmatter" | "filename" | null = null;

    const frontmatterSlug = note.frontmatter["problem"];
    if (frontmatterSlug) {
      matchedProblem =
        problems.find((p) => slugifyProblemName(p.name) === slugifyProblemName(frontmatterSlug)) ??
        null;
      if (matchedProblem) matchedBy = "frontmatter";
    }

    if (!matchedProblem) {
      matchedProblem = matchNoteTitleToProblem(note.title, problems);
      if (matchedProblem) matchedBy = "filename";
    }

    this.noteRepo.upsertByPath({
      path: note.path,
      title: note.title,
      problemId: matchedProblem?.id ?? null,
      topicId: matchedProblem?.topicId ?? null,
      frontmatter: note.frontmatter,
      content: note.content,
      contentHash: note.contentHash,
      matchedBy,
    });

    return matchedProblem != null;
  }
}

/**
 * Filename → problem matching. Exact slug only (case and punctuation folded).
 * A longer title that merely contains a shorter problem name is left unmatched:
 * "Binary Search + Prefix Sum - Basic Stuff" is not the problem "Binary Search".
 */
export function matchNoteTitleToProblem(
  title: string,
  problems: ProblemRow[],
): ProblemRow | null {
  const titleSlug = slugifyProblemName(title);
  if (!titleSlug) return null;
  return problems.find((p) => slugifyProblemName(p.name) === titleSlug) ?? null;
}

function takeawayLine(takeaway: string, date: Date): string {
  return `- ${date.toISOString().slice(0, 10)}: ${takeaway.replace(/\s+/g, " ").trim()}`;
}

function noteBelongsToProblem(note: NoteRow, problem: ProblemRow): boolean {
  const tagged = storedFrontmatter(note.frontmatter)?.problem;
  if (tagged && slugifyProblemName(tagged) === slugifyProblemName(problem.name)) return true;
  return matchNoteTitleToProblem(note.title, [problem]) != null;
}

function storedFrontmatter(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  } catch {
    return undefined;
  }
}
