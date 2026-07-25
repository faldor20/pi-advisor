import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOutcome, outcomeLogPath } from "../src/outcomes.js";

describe("outcome log", () => {
  test("writes only the versioned allowlisted privacy-minimal record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-advisor-outcomes-"));
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    const advice =
      "raw advice SENTINEL_PROMPT /private/path session-123 tool output";
    try {
      await appendOutcome({
        adoption: "followed",
        advice,
        trigger: "executor-requested",
        validationStatus: "passed",
      });
      const raw = readFileSync(outcomeLogPath(), "utf8");
      const parsed = JSON.parse(raw);
      expect(Object.keys(parsed).sort()).toEqual([
        "adoption",
        "adviceHash",
        "timestamp",
        "trigger",
        "v",
        "validationStatus",
      ]);
      expect(parsed).toMatchObject({
        adoption: "followed",
        trigger: "executor-requested",
        v: 1,
        validationStatus: "passed",
      });
      expect(raw).not.toContain("SENTINEL_PROMPT");
      expect(raw).not.toContain("/private/path");
      expect(raw).not.toContain("session-123");
    } finally {
      if (prior === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prior;
      }
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
