import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readUntrackedFiles,
  UNTRACKED_FILE_MAX_BYTES,
} from "../src/untracked.js";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "ignore" });

describe("untracked Advisor attachments", () => {
  test("reads normalized non-ASCII untracked paths and labels the attachment", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    writeFileSync(join(cwd, "ü.md"), "content");
    try {
      const attachments = await readUntrackedFiles(cwd, ["./ü.md"], true, true);
      expect(attachments).toEqual([
        { bytes: 7, path: "ü.md", text: "content" },
      ]);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("redacts PEM content whose closing delimiter is outside the file cap", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    writeFileSync(
      join(cwd, "secret.pem"),
      `-----BEGIN PRIVATE KEY-----\n${"A".repeat(
        UNTRACKED_FILE_MAX_BYTES + 1000
      )}\n-----END PRIVATE KEY-----`
    );
    try {
      const [attachment] = await readUntrackedFiles(
        cwd,
        ["secret.pem"],
        true,
        true
      );
      expect(attachment?.text).toContain("[REDACTED SECRET]");
      expect(attachment?.text).not.toContain("AAAA");
      expect(attachment?.bytes).toBeLessThanOrEqual(UNTRACKED_FILE_MAX_BYTES);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
