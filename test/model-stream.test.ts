import { describe, expect, test } from "bun:test";
import {
  collectTextStream,
  resolveConfiguredModel,
} from "../src/model-stream.js";

const model = {
  api: "test-api",
  baseUrl: "https://example.test",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "model",
  input: ["text"],
  maxTokens: 100,
  name: "Model",
  provider: "provider",
  reasoning: true,
} as any;

const assistant = (text: string, usage: unknown = { input: 1 }) => ({
  api: "test-api",
  content: text ? [{ text, type: "text" }] : [],
  model: "model",
  provider: "provider",
  role: "assistant",
  stopReason: "stop",
  timestamp: 1,
  usage,
});

const fakeStream = (
  events: unknown[],
  result: unknown,
  capture?: (options: unknown) => void
) =>
  ((_model: unknown, _context: unknown, options: unknown) => {
    capture?.(options);
    return {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        for (const event of events) {
          yield event;
        }
      },
      result: () => Promise.resolve(result),
    };
  }) as any;

describe("model stream", () => {
  test("resolves the exact configured model and provider auth", async () => {
    const seen: unknown[] = [];
    const ctx = {
      modelRegistry: {
        find: (provider: string, id: string) => {
          seen.push([provider, id]);
          return model;
        },
        getApiKeyAndHeaders: (value: unknown) => {
          seen.push(value);
          return Promise.resolve({
            apiKey: "secret",
            env: { REGION: "test" },
            headers: { "x-test": "yes" },
            ok: true,
          });
        },
      },
    } as any;
    const resolved = await resolveConfiguredModel(
      ctx,
      "provider/model",
      "Advisor"
    );
    expect(seen).toEqual([["provider", "model"], model]);
    expect(resolved).toMatchObject({
      apiKey: "secret",
      env: { REGION: "test" },
      headers: { "x-test": "yes" },
      model,
      ref: "provider/model",
    });
  });

  test("reports missing models and auth without substitution", async () => {
    await expect(
      resolveConfiguredModel(
        { modelRegistry: { find: () => undefined } } as any,
        "provider/missing",
        "Scout"
      )
    ).rejects.toThrow("Scout model not found: provider/missing");
    await expect(
      resolveConfiguredModel(
        {
          modelRegistry: {
            find: () => model,
            getApiKeyAndHeaders: () =>
              Promise.resolve({ error: "login", ok: false }),
          },
        } as any,
        "provider/model",
        "Scout"
      )
    ).rejects.toThrow("login");
  });

  test("preserves stream options, chunk order, final text, and usage", async () => {
    const chunks: string[] = [];
    let optionsSeen: any;
    const { signal } = new AbortController();
    const result = await collectTextStream(
      {
        apiKey: "key",
        env: { REGION: "test" },
        headers: { header: "value" },
        model,
        ref: "provider/model",
      },
      {
        messages: [],
        onChunk: (thinking, text) => chunks.push(`${thinking}|${text}`),
        reasoning: "high",
        signal,
        systemPrompt: "system",
      },
      fakeStream(
        [
          { delta: "think", type: "thinking_delta" },
          { delta: "partial", type: "text_delta" },
        ],
        assistant("final", { input: 3 }),
        (options) => {
          optionsSeen = options;
        }
      )
    );
    expect(chunks).toEqual(["think|", "think|partial"]);
    expect(result).toEqual({
      text: "final",
      thinking: "think",
      usage: { input: 3 },
    });
    expect(optionsSeen).toMatchObject({
      apiKey: "key",
      env: { REGION: "test" },
      headers: { header: "value" },
      reasoning: "high",
      signal,
    });
  });

  test("falls back to streamed text and preserves an empty response", async () => {
    const streamed = await collectTextStream(
      { apiKey: "key", model, ref: "provider/model" },
      { messages: [], systemPrompt: "system" },
      fakeStream([{ delta: "streamed", type: "text_delta" }], assistant(""))
    );
    expect(streamed.text).toBe("streamed");
    const empty = await collectTextStream(
      { apiKey: "key", model, ref: "provider/model" },
      { messages: [], systemPrompt: "system" },
      fakeStream([], assistant(""))
    );
    expect(empty.text).toBe("");
  });
});
