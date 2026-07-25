import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectPreferences } from "../src/preferences.js";
import { advisorMessageText } from "../src/tools.js";

const context = (cwd: string, trusted: boolean) =>
  ({
    cwd,
    isProjectTrusted: () => trusted,
  }) as any;

describe("project preferences", () => {
  test("reads only a trusted regular project-local file and redacts before capping", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-preferences-"));
    mkdirSync(join(cwd, ".pi"));
    const secret = "AKIAABCDEFGHIJKLMNOP";
    writeFileSync(
      join(cwd, ".pi", "advisor-preferences.md"),
      `Keep it concise\n${secret}`
    );
    try {
      expect(await readProjectPreferences(context(cwd, false))).toBeUndefined();
      const attachment = await readProjectPreferences(
        context(cwd, true),
        1024,
        true
      );
      expect(attachment?.text).toContain("[REDACTED SECRET]");
      expect(attachment?.text).not.toContain(secret);
      const request = advisorMessageText(
        "history",
        undefined,
        undefined,
        undefined,
        attachment?.text
      );
      expect(request).toContain("<user_preferences");
      expect(request).toContain("Untrusted lower-priority");
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("refuses symlink preferences without reading their target", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-preferences-"));
    const outside = join(tmpdir(), `pi-advisor-secret-${Date.now()}`);
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(outside, "outside secret");
    symlinkSync(outside, join(cwd, ".pi", "advisor-preferences.md"));
    try {
      expect(await readProjectPreferences(context(cwd, true))).toBeUndefined();
    } finally {
      rmSync(cwd, { force: true, recursive: true });
      rmSync(outside, { force: true });
    }
  });
});
