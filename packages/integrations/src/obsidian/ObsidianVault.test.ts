import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ObsidianVault,
  resolveTopicFolderName,
  sanitizeFolderName,
} from "./ObsidianVault.js";

describe("ObsidianVault topic folders", () => {
  it("sanitizes invalid path characters", () => {
    expect(sanitizeFolderName("Sliding Window")).toBe("Sliding Window");
    expect(sanitizeFolderName("DP: Grids")).toBe("DP- Grids");
  });

  it("reuses an existing topic folder by fuzzy slug overlap", () => {
    const existing = ["BackTracking", "Arrays"];
    expect(resolveTopicFolderName("Recursion & Backtracking", existing)).toBe("BackTracking");
  });

  it("creates a new folder name when no topic folder matches", () => {
    const existing = ["Arrays", "BackTracking"];
    expect(resolveTopicFolderName("Sliding Window", existing)).toBe("Sliding Window");
  });
});

describe("ObsidianVault.createNoteFile", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a note inside Topics/<topic>", () => {
    const root = mkdtempSync(join(tmpdir(), "dsa-vault-"));
    roots.push(root);
    mkdirSync(join(root, "Topics", "BackTracking"), { recursive: true });

    const vault = new ObsidianVault(root);
    const topicDir = vault.resolveTopicDirectory("Recursion & Backtracking");
    expect(topicDir).toBe("Topics/BackTracking");

    const path = vault.createNoteFile(
      "Palindrome Partitioning",
      "# test\n",
      topicDir,
    );
    expect(path).toBe("Topics/BackTracking/Palindrome Partitioning.md");
  });

  it("creates a new topic folder when none exists", () => {
    const root = mkdtempSync(join(tmpdir(), "dsa-vault-"));
    roots.push(root);
    mkdirSync(join(root, "Topics"), { recursive: true });

    const vault = new ObsidianVault(root);
    const topicDir = vault.resolveTopicDirectory("Sliding Window");
    expect(topicDir).toBe("Topics/Sliding Window");

    const path = vault.createNoteFile("Minimum Size Subarray Sum", "# test\n", topicDir);
    expect(path).toBe("Topics/Sliding Window/Minimum Size Subarray Sum.md");
  });
});

describe("ObsidianVault.appendToNote (P6.2)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("appends to an existing note and leaves its content intact", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "dsa-vault-"));
    roots.push(root);
    writeFileSync(join(root, "Two Sum.md"), "# Two Sum\n\nmy notes\n");
    const vault = new ObsidianVault(root);
    expect(vault.appendToNote("Two Sum.md", "- line\n")).toBe(true);
    expect(readFileSync(join(root, "Two Sum.md"), "utf-8")).toBe("# Two Sum\n\nmy notes\n- line\n");
  });

  it("refuses missing files, non-markdown files and paths outside the vault", () => {
    const root = mkdtempSync(join(tmpdir(), "dsa-vault-"));
    roots.push(root);
    const vault = new ObsidianVault(root);
    expect(vault.appendToNote("Missing.md", "x")).toBe(false);
    expect(vault.appendToNote("../outside.md", "x")).toBe(false);
    expect(vault.appendToNote("notes.txt", "x")).toBe(false);
  });
});
