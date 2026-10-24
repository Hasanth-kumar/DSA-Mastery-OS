import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import { buildApp } from "./app.js";
import { createAppContext } from "./context.js";

let testDbPath: string;

describe("GET /health", () => {
  // Never open the default ./data/sqlite/dsa.db: point both path vars at a temp file.
  beforeEach(() => {
    resetConfigCache();
    testDbPath = join(tmpdir(), `dsa-health-${Date.now()}-${Math.random()}.db`);
    process.env.SQLITE_PATH = testDbPath;
    process.env.DSA_DB_PATH = testDbPath;
  });

  afterEach(() => {
    resetConfigCache();
    delete process.env.SQLITE_PATH;
    delete process.env.DSA_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${testDbPath}${suffix}`, { force: true });
    }
  });

  it("returns health payload", async () => {
    const config = loadConfig("/nonexistent/.env");
    expect(config.sqlite.path).toBe(testDbPath);
    const ctx = createAppContext(config);
    const app = buildApp(config, ctx);
    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();

    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(body).toMatchObject({
      timestamp: expect.any(String),
      version: "0.1.0",
      services: {
        api: { status: "ok" },
        sqlite: expect.objectContaining({ status: expect.any(String) }),
      },
    });
    await app.close();
    await ctx.close();
  });
});
