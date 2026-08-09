/* biome-ignore-all lint/performance/noAwaitInLoops: table-driven async failure cases intentionally run serially. */
/* biome-ignore-all lint/suspicious/useAwait: async dependency stubs mirror the production contract. */
import { describe, expect, test } from "bun:test";
import { setExecutorEffortRef, setExecutorRef } from "../src/config.js";
import {
  parseScoutSelection,
  runAdvisorScout,
  SCOUT_SYSTEM,
} from "../src/scout.js";
import type { ScoutManifest } from "../src/scout-context.js";

const manifest = (): ScoutManifest => ({
  availableBytes: 100,
  availableCount: 3,
  groups: [
    {
      bytes: 10,
      content: "User: current task",
      id: "g_required",
      kind: "user",
      label: "current task",
      originalIndex: 2,
      required: true,
    },
    {
      bytes: 10,
      content: "Executor: useful failure",
      id: "g_failure",
      kind: "assistant",
      label: "useful failure",
      originalIndex: 0,
      required: false,
    },
    {
      bytes: 10,
      content: "Executor: redundant",
      id: "g_other",
      kind: "assistant",
      label: "redundant",
      originalIndex: 1,
      required: false,
    },
  ],
  omittedBytes: 5,
  omittedCount: 1,
});

const resolved = {
  apiKey: "key",
  model: { id: "model", provider: "provider" },
  ref: "provider/model",
} as any;
const successDependencies = (
  text: string,
  capture?: (options: any) => void
) => ({
  collect: (_resolved: unknown, options: any) => {
    capture?.(options);
    return Promise.resolve({
      text,
      thinking: "thought",
      usage: { cost: { total: 0.01 } },
    });
  },
  resolve: () => Promise.resolve(resolved),
});

describe("Advisor Scout", () => {
  test("parses a valid selection and retains useful failures", () => {
    const selection = parseScoutSelection(
      JSON.stringify({
        selectedIds: ["g_required", "g_failure"],
        synthesis: "Failure explains the remaining decision.",
      }),
      manifest()
    );
    expect(selection.selectedIds).toContain("g_failure");
  });

  test("rejects malformed, duplicate, unknown, omitted-required, and oversized output", () => {
    const invalid = [
      "not json",
      JSON.stringify({
        selectedIds: ["g_required", "g_required"],
        synthesis: "",
      }),
      JSON.stringify({
        selectedIds: ["g_required", "g_unknown"],
        synthesis: "",
      }),
      JSON.stringify({ selectedIds: ["g_failure"], synthesis: "" }),
      JSON.stringify({
        selectedIds: ["g_required"],
        synthesis: "x".repeat(4097),
      }),
      JSON.stringify({
        extra: true,
        selectedIds: ["g_required"],
        synthesis: "",
      }),
    ];
    for (const value of invalid) {
      expect(() => parseScoutSelection(value, manifest())).toThrow();
    }
  });

  test("uses the configured Executor model and effort with conversation-only input", async () => {
    setExecutorRef("provider/executor");
    setExecutorEffortRef("high");
    let options: any;
    const events: string[] = [];
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      (event) => events.push(event.type),
      1000,
      successDependencies(
        JSON.stringify({
          selectedIds: ["g_required", "g_failure"],
          synthesis: "Open decision.",
        }),
        (value) => {
          options = value;
        }
      ) as any
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.model).toBe("provider/executor");
    expect(outcome.conversation).toContain("useful failure");
    expect(outcome.conversation).toContain("non-authoritative inference");
    expect(outcome.metrics.usage).toEqual({ cost: { total: 0.01 } });
    expect(options.reasoning).toBe("high");
    expect(options.systemPrompt).toBe(SCOUT_SYSTEM);
    const input = JSON.stringify(options.messages);
    expect(input).toContain("current task");
    expect(input).not.toContain("repository_changes");
    expect(input).not.toContain("tracked_files");
    expect(events).toEqual(["call", "success"]);
  });

  test("classifies missing model and auth failures without substitution", async () => {
    setExecutorRef("provider/missing");
    for (const [message, category] of [
      ["Scout model not found: provider/missing", "missing-model"],
      ["No API key for provider/missing", "auth-error"],
    ] as const) {
      const outcome = await runAdvisorScout(
        {} as any,
        manifest(),
        undefined,
        undefined,
        100,
        {
          collect: async () => {
            throw new Error("must not run");
          },
          resolve: async () => {
            throw new Error(message);
          },
        } as any
      );
      expect(outcome).toMatchObject({ category, ok: false });
    }
  });

  test("classifies empty and invalid responses as fallback", async () => {
    for (const [text, category] of [
      ["", "empty-response"],
      ["{}", "invalid-selection"],
    ] as const) {
      const outcome = await runAdvisorScout(
        {} as any,
        manifest(),
        undefined,
        undefined,
        100,
        successDependencies(text) as any
      );
      expect(outcome).toMatchObject({ category, ok: false });
    }
  });

  test("times out as fallback and propagates its abort signal", async () => {
    let childSignal: AbortSignal | undefined;
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      undefined,
      5,
      {
        collect: async (_resolved: unknown, options: any) => {
          childSignal = options.signal;
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              {
                once: true,
              }
            )
          );
          throw new Error("unreachable");
        },
        resolve: async () => resolved,
      } as any
    );
    expect(childSignal?.aborted).toBe(true);
    expect(outcome).toMatchObject({ category: "timeout", ok: false });
  });

  test("parent abort cancels and never reports fallback", async () => {
    const parent = new AbortController();
    const events: string[] = [];
    const promise = runAdvisorScout(
      {} as any,
      manifest(),
      parent.signal,
      (event) => events.push(event.type),
      1000,
      {
        collect: async (_resolved: unknown, options: any) => {
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              {
                once: true,
              }
            )
          );
          throw new Error("unreachable");
        },
        resolve: async () => resolved,
      } as any
    );
    parent.abort();
    const outcome = await promise;
    expect(outcome).toEqual({ cancelled: true, ok: false });
    expect(events).toContain("cancelled");
    expect(events).not.toContain("fallback");
  });

  test("provider failures retain separate Scout metrics", async () => {
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      undefined,
      100,
      {
        collect: async () => {
          throw new Error("provider unavailable");
        },
        resolve: async () => resolved,
      } as any
    );
    expect(outcome).toMatchObject({
      category: "provider-error",
      metrics: { availableCount: 3, omittedBeforeScout: 1, selectedCount: 0 },
      ok: false,
    });
  });
});
