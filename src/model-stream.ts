import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  stream,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { splitRef } from "./config.js";

export interface ResolvedConfiguredModel {
  apiKey: string;
  env?: Record<string, string>;
  headers?: Record<string, string | null>;
  model: Model<Api>;
  ref: string;
}

export const resolveConfiguredModel = async (
  ctx: ExtensionContext,
  ref: string,
  label: string
): Promise<ResolvedConfiguredModel> => {
  const [provider, modelId] = splitRef(ref);
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`${label} model not found: ${ref}`);
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error((auth as { error: string }).error);
  }
  if (!auth.apiKey) {
    throw new Error(`No API key for ${ref}`);
  }
  return {
    apiKey: auth.apiKey,
    env: auth.env,
    headers: auth.headers,
    model,
    ref,
  };
};

export interface CollectTextStreamOptions {
  messages: Message[];
  onChunk?: (thinking: string, text: string) => void;
  reasoning?: string;
  signal?: AbortSignal;
  systemPrompt: string;
}

export interface CollectedTextStream {
  text: string;
  thinking: string;
  usage?: unknown;
}

export const collectTextStream = async (
  resolved: ResolvedConfiguredModel,
  options: CollectTextStreamOptions,
  streamModel: typeof stream = stream
): Promise<CollectedTextStream> => {
  let thinking = "";
  let text = "";
  const eventStream = streamModel(
    resolved.model,
    { messages: options.messages, systemPrompt: options.systemPrompt },
    {
      apiKey: resolved.apiKey,
      env: resolved.env,
      headers: resolved.headers,
      reasoning: options.reasoning as never,
      signal: options.signal,
    }
  );

  for await (const event of eventStream) {
    if (event.type === "thinking_delta") {
      thinking += event.delta;
      options.onChunk?.(thinking, text);
    } else if (event.type === "text_delta") {
      text += event.delta;
      options.onChunk?.(thinking, text);
    }
  }

  const response = await eventStream.result();
  const lastAssistant = [response].find(
    (message): message is AssistantMessage => message.role === "assistant"
  );
  const finalText =
    lastAssistant?.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("\n") || text;
  return {
    text: finalText,
    thinking,
    usage: (
      lastAssistant as (AssistantMessage & { usage?: unknown }) | undefined
    )?.usage,
  };
};
