import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type OutcomeAdoption = "followed" | "not-followed" | "unknown";
export type OutcomeValidation = "passed" | "failed" | "not-run" | "unknown";
export type OutcomeTrigger =
  | "manual"
  | "executor-requested"
  | "repeated-tool-call";
export const ADOPTIONS: OutcomeAdoption[] = [
  "followed",
  "not-followed",
  "unknown",
];
export const VALIDATIONS: OutcomeValidation[] = [
  "passed",
  "failed",
  "not-run",
  "unknown",
];
export interface OutcomeRecord {
  adoption: OutcomeAdoption;
  adviceHash: string;
  timestamp: string;
  trigger: OutcomeTrigger;
  v: 1;
  validationStatus: OutcomeValidation;
}
const MAX_LOG_BYTES = 1024 * 1024;
const statePath = () => join(getAgentDir(), "advisor-outcomes-salt");
export const outcomeLogPath = () =>
  join(getAgentDir(), "advisor-outcomes.jsonl");

const salt = async () => {
  const path = statePath();
  try {
    return await readFile(path);
  } catch {
    await mkdir(getAgentDir(), { mode: 0o700, recursive: true });
    const value = randomBytes(32);
    const temporary = `${path}.${process.pid}.${Date.now()}`;
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
    return value;
  }
};
export const adviceDigest = (advice: string, key: Buffer) =>
  createHmac("sha256", key).update(advice).digest("hex").slice(0, 16);

/** Best-effort, global-only, minimal persistent telemetry. */
export const appendOutcome = async (
  record: Omit<OutcomeRecord, "adviceHash" | "timestamp" | "v"> & {
    advice: string;
  }
) => {
  const path = outcomeLogPath();
  await mkdir(getAgentDir(), { mode: 0o700, recursive: true });
  let previous = "";
  try {
    previous = await readFile(path, "utf8");
  } catch {
    /* new log */
  }
  const next: OutcomeRecord = {
    adoption: record.adoption,
    adviceHash: adviceDigest(record.advice, await salt()),
    timestamp: new Date().toISOString(),
    trigger: record.trigger,
    v: 1,
    validationStatus: record.validationStatus,
  };
  const line = `${JSON.stringify(next)}\n`;
  const retained =
    Buffer.byteLength(previous) + Buffer.byteLength(line) > MAX_LOG_BYTES
      ? ""
      : previous;
  const temporary = `${path}.${process.pid}.${Date.now()}`;
  await writeFile(temporary, retained + line, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return next;
};
