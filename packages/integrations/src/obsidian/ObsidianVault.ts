import { watch, type FSWatcher } from "chokidar";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { slugifyProblemName } from "../util/slugify.js";

export interface ObsidianNoteFile {
  /** Path relative to the vault root. */
  path: string;
  /** Filename without extension. */
  title: string;
  frontmatter: Record<string, string>;
  /** Markdown body (frontmatter stripped). */
  content: string;
  contentHash: string;
  modifiedAt: number;
}

export interface VaultWatchHandlers {
  onChanged: (note: ObsidianNoteFile) => void;
  onRemoved: (relativePath: string) => void;
  onError?: (err: unknown) => void;
}

/** Sync-conflict duplicates that must never be ingested. */
const CONFLICT_PATTERNS = [
  /\s\(\d+\)\.md$/i, // "Two Sum (1).md"
  /conflicted copy/i, // Dropbox
  /\.sync-conflict-/i, // Syncthing
];

export function isConflictFile(filename: string): boolean {
  return CONFLICT_PATTERNS.some((re) => re.test(filename));
}

/**
 * Minimal YAML frontmatter parser — flat `key: value` pairs only, which is all
 * the note templates use. Unparseable lines are skipped, never fatal.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  content: string;
} {
  if (!raw.startsWith("---")) {
    return { frontmatter: {}, content: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, content: raw };
  }

  const block = raw.slice(raw.indexOf("\n") + 1, end);
  const content = raw.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Record<string, string> = {};

  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value) frontmatter[match[1].toLowerCase()] = value;
  }

  return { frontmatter, content };
}

/**
 * Strip Obsidian-specific syntax so LLMs never see raw link markup:
 * `![[embed]]` is dropped, `[[target|alias]]` → alias, `[[target]]` → target.
 */
export function stripWikiLinks(markdown: string): string {
  return markdown
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1");
}

/** Safe folder name for a topic directory inside the vault. */
export function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}

/**
 * Pick an existing topic folder under `Topics/` or derive a new folder name.
 * Matches case-insensitively, by slug, then by unique slug substring overlap.
 */
export function resolveTopicFolderName(
  topicName: string,
  existingFolderNames: string[],
): string {
  const trimmed = topicName.trim();
  if (!trimmed) return "Topics";

  const exact = existingFolderNames.find(
    (d) => d.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exact) return exact;

  const topicSlug = slugifyProblemName(trimmed);
  const slugMatches = existingFolderNames.filter(
    (d) => slugifyProblemName(d) === topicSlug,
  );
  if (slugMatches.length === 1) return slugMatches[0]!;

  const fuzzy = existingFolderNames.filter((d) => {
    const dSlug = slugifyProblemName(d);
    return dSlug.length > 0 && (topicSlug.includes(dSlug) || dSlug.includes(topicSlug));
  });
  if (fuzzy.length === 1) return fuzzy[0]!;

  return sanitizeFolderName(trimmed);
}

/**
 * Obsidian vault access. Existing note content is never rewritten. The write
 * paths are `createNoteFile`, which refuses to overwrite, and `appendToNote`
 * (P6.2), which only adds text to the end of an existing markdown note.
 */
export class ObsidianVault {
  private watcher: FSWatcher | null = null;

  constructor(private readonly vaultPath: string) {}

  isConfigured(): boolean {
    return Boolean(this.vaultPath) && existsSync(this.vaultPath);
  }

  get root(): string {
    return this.vaultPath;
  }

  /** Full scan of every markdown note in the vault (recursive). */
  scan(): ObsidianNoteFile[] {
    if (!this.isConfigured()) return [];
    const notes: ObsidianNoteFile[] = [];
    this.walk(this.vaultPath, notes);
    return notes;
  }

  readNote(relativePath: string): ObsidianNoteFile | null {
    const absolute = join(this.vaultPath, relativePath);
    if (!existsSync(absolute)) return null;
    return this.toNote(absolute);
  }

  /**
   * P6.2: append text to the end of an existing `.md` note inside the vault.
   * Refuses paths outside the vault and files that don't exist.
   */
  appendToNote(relativePath: string, text: string): boolean {
    if (!this.isConfigured() || isAbsolute(relativePath) || extname(relativePath) !== ".md") {
      return false;
    }
    const absolute = join(this.vaultPath, relativePath);
    const rel = relative(this.vaultPath, absolute);
    if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(absolute)) return false;
    appendFileSync(absolute, text, "utf-8");
    return true;
  }

  /** Watch for created/modified/deleted markdown files. */
  startWatching(handlers: VaultWatchHandlers): void {
    if (!this.isConfigured() || this.watcher) return;

    this.watcher = watch(this.vaultPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    const handleFile = (absolutePath: string) => {
      if (extname(absolutePath).toLowerCase() !== ".md") return;
      if (isConflictFile(basename(absolutePath))) return;
      try {
        const note = this.toNote(absolutePath);
        if (note) handlers.onChanged(note);
      } catch (err) {
        handlers.onError?.(err);
      }
    };

    this.watcher
      .on("add", handleFile)
      .on("change", handleFile)
      .on("unlink", (absolutePath) => {
        if (extname(absolutePath).toLowerCase() !== ".md") return;
        handlers.onRemoved(relative(this.vaultPath, absolutePath));
      })
      .on("error", (err) => handlers.onError?.(err));
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Resolve (and create if needed) the topic folder for a new note.
   * Returns a path relative to the vault root, e.g. `Topics/BackTracking`.
   */
  resolveTopicDirectory(topicName: string): string {
    const topicsParentAbs = this.findTopicsParentAbsolute();
    const existing = this.listTopicFolderNames(topicsParentAbs);
    const folderName = resolveTopicFolderName(topicName, existing);
    const dirAbs = join(topicsParentAbs, folderName);
    mkdirSync(dirAbs, { recursive: true });
    return relative(this.vaultPath, dirAbs);
  }

  /**
   * Create a brand-new note file (2.4). Never overwrites: returns null when a
   * file with that name already exists. Optional `relativeDir` nests the file
   * under a subfolder of the vault (e.g. `Topics/Sliding Window`).
   */
  createNoteFile(
    filename: string,
    content: string,
    relativeDir?: string,
  ): string | null {
    if (!this.isConfigured()) return null;
    const safe = filename.replace(/[/\\]/g, "-");
    const fileName = safe.endsWith(".md") ? safe : `${safe}.md`;
    const dirAbs = relativeDir ? join(this.vaultPath, relativeDir) : this.vaultPath;
    mkdirSync(dirAbs, { recursive: true });
    const absolute = join(dirAbs, fileName);
    if (existsSync(absolute)) return null;
    writeFileSync(absolute, content, { encoding: "utf-8", flag: "wx" });
    return relative(this.vaultPath, absolute);
  }

  private findTopicsParentAbsolute(): string {
    const defaultPath = join(this.vaultPath, "Topics");
    if (!this.isConfigured()) return defaultPath;

    try {
      const entries = readdirSync(this.vaultPath, { withFileTypes: true });
      const topics = entries.find(
        (e) => e.isDirectory() && e.name.toLowerCase() === "topics",
      );
      if (topics) return join(this.vaultPath, topics.name);
    } catch {
      // fall through to default
    }

    return defaultPath;
  }

  private listTopicFolderNames(topicsParentAbs: string): string[] {
    if (!existsSync(topicsParentAbs)) return [];
    try {
      return readdirSync(topicsParentAbs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  private walk(dir: string, out: ObsidianNoteFile[]): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walk(absolute, out);
      } else if (
        extname(entry.name).toLowerCase() === ".md" &&
        !isConflictFile(entry.name)
      ) {
        const note = this.toNote(absolute);
        if (note) out.push(note);
      }
    }
  }

  private toNote(absolutePath: string): ObsidianNoteFile | null {
    let raw: string;
    let modifiedAt: number;
    try {
      raw = readFileSync(absolutePath, "utf-8");
      modifiedAt = statSync(absolutePath).mtimeMs;
    } catch {
      return null;
    }

    const { frontmatter, content } = parseFrontmatter(raw);
    return {
      path: relative(this.vaultPath, absolutePath),
      title: basename(absolutePath, ".md"),
      frontmatter,
      content,
      contentHash: createHash("sha1").update(raw).digest("hex"),
      modifiedAt,
    };
  }
}

export function createObsidianVault(vaultPath: string): ObsidianVault {
  return new ObsidianVault(vaultPath);
}
