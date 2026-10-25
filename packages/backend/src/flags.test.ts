import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FEATURE_FLAGS_OFF, loadConfig, resetConfigCache } from "@dsa/shared";
import { buildApp } from "./app.js";
import { createAppContext } from "./context.js";

let testDbPath: string;

describe("GET /api/flags", () => {
  beforeEach(() => {
    resetConfigCache();
    testDbPath = join(tmpdir(), `dsa-flags-${Date.now()}-${Math.random()}.db`);
    process.env.SQLITE_PATH = testDbPath;
    process.env.DSA_DB_PATH = testDbPath;
  });

  afterEach(() => {
    resetConfigCache();
    delete process.env.SQLITE_PATH;
    delete process.env.DSA_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${testDbPath}${suffix}`, { force: true });
  });

  it("returns the configured flags, read-only", async () => {
    const base = loadConfig("/nonexistent/.env");
    const config = {
      ...base,
      schedulers: { ...base.schedulers, enabled: false },
      flags: { ...FEATURE_FLAGS_OFF, hideTopicRevision: true },
    };
    const ctx = createAppContext(config);
    const app = buildApp(config, ctx);
    try {
      const res = await app.inject({ method: "GET", url: "/api/flags" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ...FEATURE_FLAGS_OFF, hideTopicRevision: true });
      const put = await app.inject({ method: "PUT", url: "/api/flags", payload: {} });
      expect(put.statusCode).toBe(404);
    } finally {
      await app.close();
      await ctx.close();
    }
  });
});
