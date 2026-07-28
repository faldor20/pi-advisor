import { execFileSync } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { redactAndCapText } from "./conversation.js";

export const UNTRACKED_FILE_MAX_BYTES = 8 * 1024;
export const UNTRACKED_TOTAL_MAX_BYTES = 24 * 1024;
export interface UntrackedAttachment {
  bytes: number;
  path: string;
  text: string;
}

const PATH_SEGMENTS = /[\\/]/;

const within = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !path.includes("../");
};
const normalizeRelativePath = (root: string, path: string) =>
  relative(root, resolve(root, path));

const normalizeRequestedPath = (root: string, value: unknown) => {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    value.split(PATH_SEGMENTS).includes("..")
  ) {
    return;
  }
  return normalizeRelativePath(root, value);
};

const untracked = (cwd: string, path: string) => {
  const output = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", path],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
      windowsHide: true,
    }
  );
  const expected = normalizeRelativePath(cwd, path);
  return output
    .split("\0")
    .filter(Boolean)
    .some((entry) => normalizeRelativePath(cwd, entry) === expected);
};

/** Returns only exact, permitted untracked regular-file bodies. Refusals are silent. */
export const readUntrackedFiles = async (
  cwd: string,
  requested: string[],
  enabled: boolean,
  redact: boolean
): Promise<UntrackedAttachment[]> => {
  if (!(enabled && Array.isArray(requested))) {
    return [];
  }
  const root = await realpath(cwd).catch(() => undefined);
  if (!root) {
    return [];
  }
  const unique = new Set<string>();
  const attachments: UntrackedAttachment[] = [];
  let total = 0;
  for (const name of requested) {
    const normalizedName = normalizeRequestedPath(root, name);
    if (!normalizedName || unique.has(normalizedName)) {
      continue;
    }
    unique.add(normalizedName);
    try {
      const absolute = resolve(root, normalizedName);
      if (!(within(root, absolute) && untracked(root, normalizedName))) {
        continue;
      }
      // Sequentially enforce the aggregate disclosure budget.
      // biome-ignore lint/performance/noAwaitInLoops: each accepted file consumes the remaining budget.
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        continue;
      }
      const resolved = await realpath(absolute);
      if (!within(root, resolved)) {
        continue;
      }
      const file = await open(resolved, "r");
      try {
        const available = Math.min(
          UNTRACKED_FILE_MAX_BYTES,
          UNTRACKED_TOTAL_MAX_BYTES - total
        );
        if (available <= 0) {
          break;
        }
        const buffer = Buffer.alloc(available + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const text = redactAndCapText(
          buffer.subarray(0, bytesRead).toString("utf8"),
          available,
          redact
        );
        const bytes = Buffer.byteLength(text, "utf8");
        attachments.push({ bytes, path: normalizedName, text });
        total += bytes;
      } finally {
        await file.close();
      }
    } catch {
      /* refuse unreadable or non-git paths */
    }
  }
  return attachments;
};
