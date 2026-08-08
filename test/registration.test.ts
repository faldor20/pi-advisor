import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.js";
import { registerCommands } from "../src/commands.js";
import {
  contextMaxCharsRef,
  loadConfig,
  resetConfigCache,
  setAdvisorCollapseResponsesRef,
  setAdvisorRedactSecretsRef,
  setAdvisorToolPoliciesRef,
} from "../src/config.js";
import {
  createHerdrNotificationRequest,
  HerdrAdvisorActivity,
  HerdrAdvisorBlock,
  setHerdrBlockedEmitter,
} from "../src/herdr.js";
import { AdvisorSessionState } from "../src/session-state.js";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  adviceForDisplay,
  advisorMessageText,
  advisorRequestConversation,
  advisorSessionState,
  gateFailureEffectForMode,
  parseAutomaticDecision,
  registerAdvisorTool,
  resolveAdvisorRequest,
} from "../src/tools.js";
import { AdvisorSettingsSelector, SearchableModelSelector } from "../src/ui.js";

initTheme();

const SPINNER_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const MAX_CALLS_ROW_PATTERN = /Max Advisor calls\/session\s+10/;
const SIMPLE_MODE_ON = /› Simple mode\s+On/;
const SIMPLE_MODE_OFF = /› Simple mode\s+Off/;
const CONTEXT_10K = /Context window\s+10k/;
const SELECTED_CONTEXT_10K = /› Context window\s+10k/;
const SELECTED_CONTEXT_15K = /› Context window\s+15k/;
const CONTEXT_WINDOW = /Context window/g;
const ALWAYS_ON_OFF = /Always on\s+Off/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal SGR codes
const SGR_CODE = /\u001b\[[0-9;]*m/g;

// Row navigation is resolved by label so that adding a settings row cannot
// silently retarget an existing test's keystrokes.
const focusSettingsRow = (selector: any, label: string): number => {
  for (let presses = 0; presses < 60; presses += 1) {
    const screen = selector.render(120).join("\n").replace(SGR_CODE, "");
    if (screen.includes(`› ${label}`)) {
      return presses;
    }
    selector.handleInput("\u001b[B");
  }
  throw new Error(`Settings row not reachable: ${label}`);
};

const saveViaKeyboard = (selector: any): number => {
  const presses = focusSettingsRow(selector, "Save changes");
  selector.handleInput("\r");
  return presses;
};

describe("Searchable model selector", () => {
  const theme = {
    bold: (value: string) => value,
    fg: (_color: string, value: string) => value,
  } as any;
  const keybindings = { matches: () => false } as any;

  test("shows the current model first and ticked", () => {
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current", "provider/last"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => undefined,
      onSelect: () => undefined,
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    const screen = selector.render(100).join("\n");
    expect(screen.indexOf("✓ provider/current")).toBeLessThan(
      screen.indexOf("provider/other")
    );
  });

  test("keeps a configured model selectable when it is absent from the catalog", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/available"],
      currentOption: "provider/unavailable",
      keybindings,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    const screen = selector.render(100).join("\n");
    expect(screen).toContain("→ ✓ provider/unavailable");
    selector.handleInput("\r");
    expect(selected).toBe("provider/unavailable");
  });

  test("keeps the current model when Enter is pressed immediately", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    selector.render(100);
    selector.handleInput("\r");
    expect(selected).toBe("provider/current");
  });
});

describe("Advisor model command thinking levels", () => {
  test("shows configured levels first and keeps them on Enter", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisor: "provider/advisor",
        advisorEffort: "high",
        executor: "provider/executor",
        executorEffort: "low",
      })
    );
    resetConfigCache();
    const commands = new Map<string, any>();
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
    } as unknown as ExtensionAPI;
    const effortChoicesSeen: string[][] = [];
    const theme = {
      bold: (value: string) => value,
      fg: (_color: string, value: string) => value,
    } as any;

    try {
      registerCommands(mockPi);
      await commands.get("advisor-models").handler("", {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          getAvailable: () => [
            { id: "executor", provider: "provider" },
            { id: "advisor", provider: "provider" },
          ],
        },
        ui: {
          custom: (factory: any) =>
            new Promise((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                theme,
                { matches: () => false },
                resolve
              );
              selector.render(100);
              selector.handleInput("\r");
            }),
          notify: () => undefined,
          select: (_title: string, choices: string[]) => {
            effortChoicesSeen.push(choices);
            return Promise.resolve(choices[0]);
          },
        },
      } as any);

      expect(effortChoicesSeen).toEqual([
        [
          "✓ low",
          "Default (Model Default)",
          "off",
          "minimal",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
        [
          "✓ high",
          "Default (Model Default)",
          "off",
          "minimal",
          "low",
          "medium",
          "xhigh",
          "max",
        ],
      ]);
      const saved = JSON.parse(
        readFileSync(join(agentDir, "advisor.json"), "utf8")
      );
      expect(saved.executorEffort).toBe("low");
      expect(saved.advisorEffort).toBe("high");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});

describe("Herdr Advisor activity", () => {
  test("constructs sanitized request notifications within Herdr limits", () => {
    const request = createHerdrNotificationRequest(
      "bad\n title",
      "  details\u0000 with   spacing "
    );
    expect(request.method).toBe("notification.show");
    expect(request.params).toMatchObject({
      body: "details with spacing",
      position: "top-left",
      sound: "request",
      title: "bad title",
    });
    expect(request.params.title.length).toBeLessThanOrEqual(80);
    expect(request.params.body.length).toBeLessThanOrEqual(240);
  });
  test("keeps seeking advice visible until overlapping consultations finish", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );

    activity.start();
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(1);
    expect(reports[0].params).toMatchObject({
      agent: "pi",
      applies_to_source: "herdr:pi",
      state_labels: { working: "seeking advice" },
    });

    activity.finish();
    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("clears seeking advice on shutdown", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );

    activity.start();
    activity.clear();
    activity.clear();

    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("does not report activity or blocked metadata when integration is disabled", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity(
      (request) => reports.push(request),
      () => false
    );
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(0);
  });

  test("does not let unavailable Herdr reporting interrupt advice", () => {
    const activity = new HerdrAdvisorActivity(() => {
      throw new Error("socket unavailable");
    });

    expect(() => activity.start()).not.toThrow();
    expect(() => activity.finish()).not.toThrow();
  });

  test("redacts and bounds blocked labels and clears after integration is disabled", () => {
    const reports: any[] = [];
    let enabled = true;
    const block = new HerdrAdvisorBlock(
      (request) => reports.push(request),
      () => enabled
    );
    block.set(`token=super-secret-token-value\n${"x".repeat(500)}`);
    enabled = false;
    block.clear();
    block.clear();

    expect(reports).toHaveLength(2);
    expect(reports[0].params.state_labels.blocked).toContain(
      "[REDACTED SECRET]"
    );
    expect(reports[0].params.state_labels.blocked).not.toContain(
      "super-secret-token-value"
    );
    expect(reports[0].params.state_labels.blocked.length).toBeLessThanOrEqual(
      200
    );
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("emits one herdr:blocked edge per block and one clear", () => {
    const events: boolean[] = [];
    setHerdrBlockedEmitter((active) => events.push(active));
    try {
      const block = new HerdrAdvisorBlock(
        () => undefined,
        () => true
      );
      block.set("first");
      block.set("second");
      block.clear();
      block.clear();

      expect(events).toEqual([true, false]);
    } finally {
      setHerdrBlockedEmitter(undefined);
    }
  });
});

describe("Advisor consultation and gate contracts", () => {
  test("keeps automatic decision instructions separate from manual Markdown", () => {
    expect(ADVISOR_SYSTEM).toContain("human-readable Markdown");
    expect(ADVISOR_SYSTEM).not.toContain("JSON");
    expect(ADVISOR_DECISION_SYSTEM).toContain("Decision: proceed");
    expect(ADVISOR_DECISION_SYSTEM).not.toContain("insufficient-evidence");
  });

  test("accepts strict gate headers with casing and surrounding whitespace", () => {
    for (const [text, decision] of [
      ["Decision: proceed\nContinue", "proceed"],
      ["\n  dEcIsIoN: REVISE  \nRetry", "revise"],
      ["Decision: BLOCKED\nStop", "blocked"],
    ] as const) {
      const result = parseAutomaticDecision(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.decision).toBe(decision);
      }
    }
  });

  test("classifies missing, malformed, duplicate, and contradictory gate decisions", () => {
    const expectFailure = (text: string, category: any) => {
      const result = parseAutomaticDecision(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.category).toBe(category);
      }
    };
    expectFailure("", "empty-response");
    expectFailure("Advice\nDecision: proceed", "missing-decision");
    expectFailure("Decision: proceed now", "malformed-decision");
    expectFailure("Decision: proceed\nDecision: proceed", "duplicate-decision");
    expectFailure(
      "Decision: proceed\nDecision: blocked",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```\nDecision: blocked",
      "contradictory-decision"
    );
  });

  test("escapes closing tags in every untrusted Advisor prompt region", () => {
    const request = advisorMessageText(
      "</conversation>",
      undefined,
      undefined,
      "</draft>",
      "</user_preferences>",
      ["</untracked_files>"]
    );
    expect(request).not.toContain("\n</conversation>\n</conversation>");
    expect(request).toContain("&lt;/conversation&gt;");
    expect(request).toContain("&lt;/draft&gt;");
    expect(request).toContain("&lt;/user_preferences&gt;");
    expect(request).toContain("&lt;/untracked_files&gt;");
    expect(
      advisorMessageText(
        "context",
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        ["</tracked_files>"]
      )
    ).toContain("&lt;/tracked_files&gt;");
  });

  test("maps every configured gate failure mode without escalation", () => {
    expect(gateFailureEffectForMode("block-session")).toBe("session-blocked");
    expect(gateFailureEffectForMode("block-tool")).toBe("tool-blocked");
    expect(gateFailureEffectForMode("warn-and-continue")).toBe("continued");
  });

  test("does not retain the legacy JSON parser or synthesize normal verdicts", () => {
    const source = readFileSync(
      new URL("../src/tools.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("parseAdvice");
    expect(source).not.toContain("JSON.parse");
    expect(
      parseAutomaticDecision("Decision: revise\nMarkdown explanation")
    ).not.toHaveProperty("verdict");
  });
});

describe("Extension Registration", () => {
  test("exports the stable consultation and gate contract", () => {
    expect(typeof consultAdvisor).toBe("function");
    expect(typeof runAdvisorGate).toBe("function");
    expect(typeof parseAutomaticDecision).toBe("function");
  });
  test("should register advisor tool and commands correctly", () => {
    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];

    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, _config: any) {
        registeredCommands.push(name);
      },
      registerTool(tool: any) {
        registeredTools.push(tool.name);
      },
    } as unknown as ExtensionAPI;

    registerExtension(mockPi);

    // Verify tool registered
    expect(registeredTools).toContain("ask_advisor");

    // Verify all commands registered
    expect(registeredCommands).toContain("advisor");
    expect(registeredCommands).toContain("advisor-manual");
    expect(registeredCommands).toContain("advisor-models");
    expect(registeredCommands).toContain("advisor-settings");
    expect(registeredCommands).toContain("advisor-off");
  });

  test("fans a manual Advisor response out to the Executor without waiting for the command", async () => {
    const commands = new Map<string, any>();
    const sent: Array<{ message: any; options: any }> = [];
    let receivedQuestion: string | undefined;
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage(message: any, options: any) {
        sent.push({ message, options });
      },
    } as unknown as ExtensionAPI;

    registerCommands(mockPi, {
      consult: (_ctx, question) => {
        receivedQuestion = question;
        return Promise.resolve({
          markdown: "Ship the focused fix.",
          thinkingText: "",
        });
      },
    });

    await commands.get("advisor-manual").handler("Check the migration", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receivedQuestion).toBe("Check the migration");
    expect(sent).toEqual([
      {
        message: expect.objectContaining({
          content: expect.stringContaining("Ship the focused fix."),
          customType: "advisor-manual-result",
          details: expect.objectContaining({
            question: "Check the migration",
            text: "Ship the focused fix.",
          }),
        }),
        options: { deliverAs: "steer", triggerTurn: true },
      },
    ]);
  });

  test("adds an immediate Advisor call entry to the transcript", async () => {
    const commands = new Map<string, any>();
    const entries: Array<{ type: string; data: unknown }> = [];
    const mockPi = {
      appendEntry(type: string, data: unknown) {
        entries.push({ data, type });
      },
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: () => new Promise(() => undefined),
    });

    await commands.get("advisor-manual").handler("Check the migration", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });

    expect(entries).toEqual([
      {
        data: { question: "Check the migration" },
        type: "advisor-manual-call",
      },
    ]);
  });

  test("cancels a manual consultation before its late response can fan out", async () => {
    const commands = new Map<string, any>();
    const events = new Map<string, () => void>();
    const sent: unknown[] = [];
    let resolveConsult!: (value: {
      markdown: string;
      thinkingText: string;
    }) => void;
    const pendingConsult = new Promise<{
      markdown: string;
      thinkingText: string;
    }>((resolve) => {
      resolveConsult = resolve;
    });
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on(event: string, handler: () => void) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage(message: unknown) {
        sent.push(message);
      },
    } as unknown as ExtensionAPI;

    advisorSessionState.resetTask();
    registerCommands(mockPi, { consult: async () => pendingConsult });
    await commands.get("advisor-manual").handler("", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    expect(sent).toEqual([]);

    events.get("session_shutdown")?.();
    resolveConsult({ markdown: "Too late.", thinkingText: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);
    expect(advisorSessionState.summary(undefined)).toBeUndefined();
  });

  test("replaces an in-flight manual consultation with a newer request", async () => {
    const commands = new Map<string, any>();
    const signals: AbortSignal[] = [];
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: (_ctx, _question, signal) => {
        if (!signal) {
          throw new Error("Manual consultation requires an abort signal.");
        }
        signals.push(signal);
        return new Promise<{ markdown: string; thinkingText: string }>(
          () => undefined
        );
      },
    });

    await commands.get("advisor-manual").handler("First", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    await commands.get("advisor-manual").handler("Second", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test("distinguishes the executor request from the advisor response", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    expect(advisorTool.parameters.required).toBeUndefined();
    expect(advisorTool.parameters.properties.includeTrackedFiles).toBeDefined();

    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
    };
    const request = advisorTool
      .renderCall({ question: "Should we ship this change?" }, theme, context)
      .render(120)
      .join("\n");
    const response = advisorTool
      .renderResult(
        {
          content: [
            { text: "Advisor (test/model)\n\n**Ship it.**", type: "text" },
          ],
          details: { advisor: "test/model", text: "**Ship it.**" },
        },
        { isPartial: false },
        theme,
        context
      )
      .render(120)
      .join("\n");

    expect(request).toContain("[advisor] Executor → Advisor");
    expect(request).toContain("Should we ship this change?");
    expect(request).not.toMatch(SPINNER_PATTERN);
    expect(response).toContain("ADVISOR RESPONSE");
    expect(response).toContain("test/model");
    expect(response).toContain("Ship it.");
    expect(response).not.toContain("**Ship it.**");
    expect(response).not.toContain("Advisor (test/model)");

    const markdownPartial = advisorTool
      .renderResult(
        {
          content: [{ text: "The migration looks safe so far", type: "text" }],
          details: { text: "The migration looks safe so far" },
        },
        { isPartial: true },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(markdownPartial).toContain("The migration looks safe so far");
    expect(markdownPartial).not.toContain("criticalFindings");
  });

  test("advertises and uses a general contextual request when the question is omitted", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    expect(advisorTool.description).toContain("empty object");
    expect(advisorTool.promptSnippet).toContain("existing context");
    expect(advisorTool.promptGuidelines.join(" ")).toContain("empty object");
    expect(advisorTool.promptGuidelines.join(" ")).toContain(
      "sequential follow-up"
    );
    expect(ADVISOR_SYSTEM).toContain(
      "No question or other input from the Executor is needed"
    );
    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
    };
    const noQuestionCall = advisorTool
      .renderCall({}, theme, context)
      .render(120)
      .join("\n");
    expect(noQuestionCall).toContain("[advisor] Executor → Advisor");
    expect(noQuestionCall).not.toContain("General task review");
    expect(resolveAdvisorRequest()).toBeUndefined();
    expect(resolveAdvisorRequest("   ")).toBeUndefined();
    expect(resolveAdvisorRequest("Review the migration plan.")).toBe(
      "Review the migration plan."
    );
    expect(advisorMessageText("User: review this")).toBe(
      "<conversation>\nUser: review this\n</conversation>"
    );
    expect(
      advisorMessageText("User: review this", "Check the migration")
    ).toContain("Targeted focus:\nCheck the migration");
  });

  test("applies redaction at the Advisor request-context boundary", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            message: { content: `api_key=${secret}`, role: "user" },
            type: "message",
          },
          {
            message: {
              content: secret,
              role: "toolResult",
              toolName: "custom",
            },
            type: "message",
          },
        ],
      },
    } as any;
    setAdvisorRedactSecretsRef(true);
    setAdvisorToolPoliciesRef({});
    try {
      const context = advisorRequestConversation(ctx);
      expect(context).not.toContain(secret);
      expect(context).toContain("[REDACTED SECRET]");
    } finally {
      setAdvisorRedactSecretsRef(false);
      setAdvisorToolPoliciesRef({});
    }
  });

  test("injects only the enabled invocation rules into the active prompt", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisorCompletionGate: false,
        advisorCustomInvocation: "a deployment changes production data",
        advisorFailureGate: true,
        advisorPlanGate: false,
      })
    );
    let beforeAgentStart: any;
    const mockPi = {
      getActiveTools() {
        return ["ask_advisor"];
      },
      on(event: string, handler: any) {
        if (event === "before_agent_start") {
          beforeAgentStart = handler;
        }
      },
      registerCommand: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;

    try {
      registerExtension(mockPi);
      const result = beforeAgentStart(
        {},
        {
          cwd: tmpdir(),
          getSystemPrompt: () => "Base prompt",
          isProjectTrusted: () => false,
        }
      );
      expect(result.systemPrompt).toContain(
        "two consecutive materially equivalent failed attempts"
      );
      expect(result.systemPrompt).toContain(
        "a deployment changes production data"
      );
      expect(result.systemPrompt).not.toContain("consequential plan");
      expect(result.systemPrompt).not.toContain("Before declaring success");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("keeps Advisor settings on one screen and saves keyboard changes", () => {
    let saved: any;
    let renderRequests = 0;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)", "high"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
      },
      onCancel: () => undefined,
      onSave: (settings) => {
        saved = settings;
      },
      presets: [
        { description: "No history", label: "0", value: 0 },
        { description: "Recent history", label: "10k", value: 10_000 },
      ],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: {
        requestRender: () => {
          renderRequests += 1;
        },
      },
    });
    // Context is the first advanced row because the slider appears above it.
    selector.handleInput("\u001b[C");
    const downsToSave = saveViaKeyboard(selector);
    // One right plus the downs to Save; Enter saves without a render.
    expect(renderRequests).toBe(1 + downsToSave);
    expect(saved.contextMaxChars).toBe(10_000);
    const screen = selector.render(80).join("\n");
    expect(screen).toContain("Advisor reasoning");
    expect(screen).toContain("Custom invocation");
    expect(screen).toContain("Gate failure mode");
    expect(screen).toContain("Herdr integration");
    expect(screen).toContain("Redact common secrets");
    expect(screen).toContain("Tool disclosure policies");
    expect(screen).toContain("▲");
  });

  test("preserves explicit privacy settings through the selector", () => {
    let saved: any;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
        redactSecrets: true,
        toolPolicies: { bash: "summary", deploy: "exclude" },
      },
      onCancel: () => undefined,
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    saveViaKeyboard(selector);
    expect(saved).toMatchObject({
      redactSecrets: true,
      toolPolicies: { bash: "summary", deploy: "exclude" },
    });
  });

  test("keeps invalid tool disclosure policies open with an actionable error", () => {
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
      },
      onCancel: () => undefined,
      onSave: () => undefined,
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    focusSettingsRow(selector, "Tool disclosure policies");
    selector.handleInput("\r");

    (selector as any).policiesInput.onSubmit('{"bash":"invalid"}');
    expect(selector.render(120).join("\n")).toContain(
      "Use non-empty tool names with full, summary, or exclude values."
    );
    expect((selector as any).editingPolicies).toBe(true);

    (selector as any).policiesInput.onSubmit("{");
    expect(selector.render(120).join("\n")).toContain(
      "Enter a valid JSON object."
    );
    expect((selector as any).editingPolicies).toBe(true);
  });

  test("edits the custom invocation rule inline", () => {
    let saved: any;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
      },
      onCancel: () => undefined,
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: {
        requestRender: () => undefined,
      },
    });
    focusSettingsRow(selector, "Custom invocation");
    selector.handleInput("\r");
    selector.handleInput("d");
    selector.handleInput("e");
    selector.handleInput("p");
    selector.handleInput("l");
    selector.handleInput("o");
    selector.handleInput("y");
    selector.handleInput("\r");
    saveViaKeyboard(selector);
    expect(saved.customRule).toBe("deploy");
  });

  test("reopens Advisor settings with the value saved in the same session", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorMaxCallsPerSession: 5 })
    );
    const commands = new Map<string, any>();
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    } as any;
    const custom = async (factory: any) =>
      new Promise<any>((resolve) => {
        const selector = factory(
          { requestRender: () => undefined },
          theme,
          {},
          resolve
        );
        focusSettingsRow(selector, "Max Advisor calls/session");
        selector.handleInput("\u001b[C");
        saveViaKeyboard(selector);
      });
    const reopened = async (factory: any) =>
      new Promise<any>((resolve) => {
        const selector = factory(
          { requestRender: () => undefined },
          theme,
          {},
          resolve
        );
        expect(selector.render(100).join("\n")).toMatch(MAX_CALLS_ROW_PATTERN);
        selector.handleInput("\u001b");
      });
    const mockPi = {
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
    } as unknown as ExtensionAPI;
    const context = {
      cwd: tmpdir(),
      hasUI: true,
      isProjectTrusted: () => false,
      ui: { custom, notify: () => undefined },
    } as any;

    try {
      registerCommands(mockPi);
      await commands.get("advisor-settings").handler("", context);
      expect(
        JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"))
      ).toMatchObject({ advisorMaxCallsPerSession: 10 });
      context.ui.custom = reopened;
      await commands.get("advisor-settings").handler("", context);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("keeps Advisor answers expanded unless collapse is enabled", () => {
    const longAnswer = Array.from(
      { length: 14 },
      (_, index) => `line ${index + 1}`
    ).join("\n");
    setAdvisorCollapseResponsesRef(false);
    expect(adviceForDisplay(longAnswer, false)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(true);
    expect(adviceForDisplay(longAnswer, false)).toContain("Ctrl+O to expand");
    expect(adviceForDisplay(longAnswer, true)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(false);
  });

  test("animates only while the advisor response is partial", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {} as { timerId?: ReturnType<typeof setInterval> },
    };
    const partial = advisorTool
      .renderResult(
        { content: [], details: {} },
        { isPartial: true },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(partial).toMatch(SPINNER_PATTERN);
    expect(context.state.timerId).toBeDefined();

    advisorTool.renderResult(
      { content: [{ text: "Done.", type: "text" }], details: {} },
      { isPartial: false },
      theme,
      context
    );
    expect(context.state.timerId).toBeUndefined();
  });
});

describe("Advisor activation and mode regressions", () => {
  const plainTheme = {
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  } as any;

  const withAgentDir = async (
    initial: Record<string, unknown>,
    run: (agentDir: string) => Promise<void> | void
  ) => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify(initial, null, 2)
    );
    resetConfigCache();
    try {
      await run(agentDir);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  };

  const harness = () => {
    const commands = new Map<string, any>();
    const events = new Map<string, (event: any, ctx: any) => any>();
    const renderers = new Map<string, any>();
    let activeTools: string[] = ["ask_advisor"];
    const pi = {
      appendEntry: () => undefined,
      getActiveTools: () => activeTools,
      on(event: string, handler: any) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      registerEntryRenderer: () => undefined,
      registerMessageRenderer(type: string, renderer: any) {
        renderers.set(type, renderer);
      },
      sendMessage: () => undefined,
      setActiveTools(tools: string[]) {
        activeTools = tools;
      },
      setModel: () => Promise.resolve(true),
      setThinkingLevel: () => undefined,
    } as unknown as ExtensionAPI;
    return {
      commands,
      events,
      pi,
      renderers,
      setActiveTools: (tools: string[]) => {
        activeTools = tools;
      },
    };
  };

  const context = (agentDir: string, notes: string[] = []) =>
    ({
      cwd: agentDir,
      hasUI: true,
      isProjectTrusted: () => false,
      modelRegistry: {
        find: (provider: string, id: string) => ({ id, provider }),
        getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
      },
      ui: { notify: (message: string) => notes.push(message) },
    }) as any;

  const savedConfig = (agentDir: string) =>
    JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"));

  test("only an explicit model selection redefines the persisted Executor", async () => {
    await withAgentDir(
      { executor: "configured/executor" },
      async (agentDir) => {
        const { events, pi } = harness();
        registerCommands(pi);
        const ctx = context(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        for (const source of ["restore", "cycle"] as const) {
          events.get("model_select")?.(
            { model: { id: "other", provider: "vendor" }, source },
            ctx
          );
          expect(savedConfig(agentDir).executor).toBe("configured/executor");
        }

        events.get("model_select")?.(
          { model: { id: "chosen", provider: "vendor" }, source: "set" },
          ctx
        );
        expect(savedConfig(agentDir).executor).toBe("vendor/chosen");
      }
    );
  });

  test("ignores model selection while the Advisor flow is inactive", async () => {
    await withAgentDir({ executor: "configured/executor" }, (agentDir) => {
      const { events, pi, setActiveTools } = harness();
      registerCommands(pi);
      setActiveTools([]);
      events.get("model_select")?.(
        { model: { id: "chosen", provider: "vendor" }, source: "set" },
        context(agentDir)
      );
      expect(savedConfig(agentDir).executor).toBe("configured/executor");
    });
  });

  test("reports rather than throws when always-on activation fails", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      writeFileSync(join(agentDir, "advisor.json"), "{ not json");
      resetConfigCache();
      const { events, pi } = harness();
      registerCommands(pi);
      const notes: string[] = [];
      await events.get("session_start")?.(
        { reason: "startup" },
        context(agentDir, notes)
      );
      expect(notes.join("\n")).toContain("Advisor activation failed");
    });
  });

  test("activates silently for always-on sessions but announces /advisor", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      const { commands, events, pi, setActiveTools } = harness();
      registerCommands(pi);
      const automatic: string[] = [];
      setActiveTools([]);
      await events.get("session_start")?.(
        { reason: "startup" },
        context(agentDir, automatic)
      );
      expect(automatic).toEqual([]);
      expect(pi.getActiveTools()).toContain("ask_advisor");

      const manual: string[] = [];
      await commands.get("advisor").handler("", context(agentDir, manual));
      expect(manual.join("\n")).toContain("Advisor flow ready");
    });
  });

  test("turning the Advisor off also clears persistent activation", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      const { commands, events, pi } = harness();
      registerCommands(pi);
      const notes: string[] = [];
      const ctx = context(agentDir, notes);
      await events.get("session_start")?.({ reason: "startup" }, ctx);

      await commands.get("advisor-off").handler("", ctx);
      expect(pi.getActiveTools()).not.toContain("ask_advisor");
      expect(savedConfig(agentDir).alwaysOn).toBe(false);
      expect(notes.at(-1)).toContain("Always on turned off");
    });
  });

  test("persists context arguments supplied to /advisor", async () => {
    await withAgentDir({ contextMaxChars: 15_000 }, async (agentDir) => {
      const { commands, pi } = harness();
      registerCommands(pi);
      await commands
        .get("advisor")
        .handler("contextMaxChars=5000", context(agentDir));
      expect(savedConfig(agentDir).contextMaxChars).toBe(5000);
      expect(loadConfig(context(agentDir))).toBeTruthy();
      expect(contextMaxCharsRef).toBe(5000);
    });
  });

  test("renders a manual sound verdict exactly like the tool response", async () => {
    await withAgentDir({}, () => {
      const { pi, renderers } = harness();
      registerCommands(pi);
      const render = (text: string) =>
        renderers
          .get("advisor-manual-result")(
            { content: text, details: { advisor: "test/model", text } },
            { expanded: true },
            plainTheme
          )
          .render(120)
          .join("\n");
      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "◆ ADVISOR · SOUND"
      );
      expect(render("Consider reverting the migration.")).toContain(
        "◆ ADVISOR RESPONSE"
      );
    });
  });
});

describe("Advisor settings navigation and gate parsing regressions", () => {
  const selectorTheme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  } as any;

  // The Simple mode row animates a per-character gradient while enabled.
  const plain = (selector: any) =>
    selector.render(100).join("\n").replace(SGR_CODE, "");

  const openSelector = (initial: any) => {
    const saved: any[] = [];
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)", "low", "high"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 15_000,
        effort: "Default (Model Default)",
        failureGate: true,
        planGate: true,
        ...initial,
      },
      onCancel: () => undefined,
      onSave: (value: any) => saved.push(value),
      presets: [
        { description: "none", label: "0", value: 0 },
        { description: "10k", label: "10k", value: 10_000 },
        { description: "15k", label: "15k", value: 15_000 },
      ],
      theme: selectorTheme,
      tui: { requestRender: () => undefined },
    } as any);
    return { saved, selector };
  };

  test("steps every off-preset numeric setting from its configured value", () => {
    const { saved, selector } = openSelector({
      contextMaxChars: 12_000,
      gitContextMaxChars: 30_000,
      loopThreshold: 7,
      maxCallsPerSession: 7,
      toolResultMaxBytes: 75_000,
      toolResultMaxLines: 3000,
    });
    for (const row of [
      "Context window",
      "Loop threshold",
      "Max Advisor calls/session",
      "Tool result lines",
      "Tool result bytes",
      "Repository context chars",
    ]) {
      focusSettingsRow(selector, row);
      selector.handleInput("\u001b[C");
    }
    saveViaKeyboard(selector);
    expect(saved[0]).toMatchObject({
      contextMaxChars: 15_000,
      gitContextMaxChars: 50_000,
      loopThreshold: 8,
      maxCallsPerSession: 10,
      toolResultMaxBytes: 100 * 1024,
      toolResultMaxLines: 5000,
    });
  });

  test("steps custom numeric values down to the adjacent preset", () => {
    const { saved, selector } = openSelector({
      contextMaxChars: 12_000,
      maxCallsPerSession: 7,
    });
    focusSettingsRow(selector, "Context window");
    selector.handleInput("\u001b[D");
    focusSettingsRow(selector, "Max Advisor calls/session");
    selector.handleInput("\u001b[D");
    saveViaKeyboard(selector);
    expect(saved[0]).toMatchObject({
      contextMaxChars: 10_000,
      maxCallsPerSession: 5,
    });
  });

  test("focuses the advanced Context slider and changes its value", () => {
    const { selector } = openSelector({
      contextMaxChars: 10_000,
      simpleMode: false,
    });
    // The top slider is the first keyboard-selectable advanced row, with no
    // duplicate Context row after the mode controls.
    const before = plain(selector);
    expect(before).toMatch(SELECTED_CONTEXT_10K);
    expect(before.indexOf("Context window")).toBeLessThan(
      before.indexOf("Simple mode")
    );
    expect(before.match(CONTEXT_WINDOW)).toHaveLength(1);
    selector.handleInput("\u001b[C");
    expect(plain(selector)).toMatch(SELECTED_CONTEXT_15K);
  });

  test("keeps the cursor on Simple mode across a mode toggle", () => {
    const { selector } = openSelector({
      contextMaxChars: 10_000,
      simpleMode: false,
    });
    selector.handleInput("\u001b[B");
    selector.handleInput("\u001b[C");
    expect(plain(selector)).toMatch(SIMPLE_MODE_ON);
    // The second toggle must return to advanced rather than move the slider.
    selector.handleInput("\u001b[C");
    const screen = plain(selector);
    expect(screen).toMatch(SIMPLE_MODE_OFF);
    expect(screen).toMatch(CONTEXT_10K);
  });

  test("keeps the cursor on Simple mode when leaving Simple mode", () => {
    const { selector } = openSelector({
      alwaysOn: false,
      simpleMode: true,
    });
    // Simple mode is the second row while Simple mode is on.
    selector.handleInput("\u001b[B");
    selector.handleInput("\u001b[C");
    expect(plain(selector)).toMatch(SIMPLE_MODE_OFF);
    // The cursor must not have landed on Always on.
    selector.handleInput("\u001b[C");
    const screen = plain(selector);
    expect(screen).toMatch(SIMPLE_MODE_ON);
    expect(screen).toMatch(ALWAYS_ON_OFF);
  });

  test("treats a quoted decision inside a fenced example as illustrative", () => {
    const result = parseAutomaticDecision(
      "Decision: revise\n\nUse this format:\n\n```\nDecision: proceed\n```\n\nThen retry."
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toBe("revise");
    }
  });

  test("still rejects a real second decision outside a fenced example", () => {
    const result = parseAutomaticDecision(
      "Decision: revise\n\n```\nDecision: proceed\n```\n\nDecision: blocked"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe("contradictory-decision");
    }
  });

  test("never sends an empty Advisor request body", () => {
    expect(advisorMessageText("", undefined).trim().length).toBeGreaterThan(0);
    expect(advisorMessageText("", "Focus")).toContain("Focus");
    expect(advisorMessageText("history", undefined)).toContain(
      "<conversation>"
    );
  });

  test("keeps concurrent registrations' safety state isolated", () => {
    const firstState = new AdvisorSessionState();
    const secondState = new AdvisorSessionState();
    const firstStarts: Array<() => void> = [];
    const secondStarts: Array<() => void> = [];
    const makePi = (starts: Array<() => void>) =>
      ({
        getActiveTools: () => [],
        on(event: string, handler: any) {
          if (event === "session_start") {
            starts.push(handler);
          }
        },
        registerMessageRenderer: () => undefined,
        registerTool: () => undefined,
      }) as unknown as ExtensionAPI;

    registerAdvisorTool(makePi(firstStarts), firstState);
    registerAdvisorTool(makePi(secondStarts), secondState);
    firstStarts[0]();
    firstState.block("first session remains blocked");
    firstState.consumeCall();

    secondStarts[0]();

    expect(firstState.blockedReason).toBe("first session remains blocked");
    expect(firstState.consumedCalls).toBe(1);
    expect(secondState.blocked).toBe(false);
    expect(secondState.consumedCalls).toBe(0);
  });

  test("keeps a recorded session block active after ask_advisor is disabled", () => {
    let toolCall: any;
    const mockPi = {
      events: { emit: () => undefined },
      getActiveTools: () => [],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerCommand: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerAdvisorTool(mockPi);
    advisorSessionState.resetTask();
    advisorSessionState.block("still blocked");
    try {
      expect(
        toolCall(
          { input: {}, toolCallId: "disabled", toolName: "read" },
          { hasUI: false }
        )
      ).toMatchObject({ block: true, reason: "still blocked" });
    } finally {
      advisorSessionState.clearBlocked();
    }
  });

  test("reserves ask_advisor without consuming its budget", () => {
    let toolCall: any;
    const mockPi = {
      events: { emit: () => undefined },
      getActiveTools: () => ["ask_advisor"],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerCommand: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);
    advisorSessionState.resetTask();
    toolCall(
      { input: {}, toolCallId: "reserved", toolName: "ask_advisor" },
      { cwd: tmpdir(), hasUI: false, isProjectTrusted: () => false }
    );
    expect(advisorSessionState.consumedCalls).toBe(0);
  });

  test("does not let project Simple mode clear a stale block", async () => {
    let toolCall: any;
    const mockPi = {
      getActiveTools: () => ["ask_advisor"],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerCommand: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerAdvisorTool(mockPi);

    // loadConfig runs per tool call, so the mode must come from a real file.
    const projectDir = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    const configPath = join(projectDir, ".pi", "advisor.json");
    const ctx = {
      cwd: projectDir,
      hasUI: false,
      isProjectTrusted: () => true,
    } as any;

    try {
      writeFileSync(configPath, JSON.stringify({ simpleMode: false }));
      resetConfigCache();
      advisorSessionState.block("earlier gate failure");
      expect(
        toolCall({ input: {}, toolCallId: "1", toolName: "read" }, ctx)
      ).toMatchObject({ block: true });

      writeFileSync(configPath, JSON.stringify({ simpleMode: true }));
      resetConfigCache();
      expect(
        await toolCall({ input: {}, toolCallId: "2", toolName: "read" }, ctx)
      ).toMatchObject({ block: true, reason: "earlier gate failure" });
      expect(advisorSessionState.blocked).toBe(true);
    } finally {
      advisorSessionState.clearBlocked();
      resetConfigCache();
      rmSync(projectDir, { force: true, recursive: true });
    }
  });
});

describe("Command configuration errors", () => {
  test("notifies and exits every config-loading command", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(join(agentDir, "advisor.json"), "{ not valid json");
    resetConfigCache();
    const commands = new Map<string, any>();
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
    } as unknown as ExtensionAPI;
    const notifications: Array<{ message: string; level: string }> = [];
    const context = {
      cwd: tmpdir(),
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        notify: (message: string, level: string) =>
          notifications.push({ level, message }),
      },
    } as any;

    try {
      registerCommands(mockPi);
      await Promise.all(
        ["advisor", "advisor-manual", "advisor-models", "advisor-settings"].map(
          (name) =>
            expect(
              commands.get(name).handler("", context)
            ).resolves.toBeUndefined()
        )
      );
      expect(notifications).toHaveLength(4);
      for (const notification of notifications) {
        expect(notification.level).toBe("error");
        expect(notification.message).toContain("advisor.json");
        expect(notification.message).toContain("Fix");
      }
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});

describe("Advisor argument persistence", () => {
  test("does not persist arguments that name an unusable model", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        alwaysOn: true,
        contextMaxChars: 15_000,
        executor: "good/executor",
      })
    );
    resetConfigCache();
    const commands = new Map<string, any>();
    const notes: string[] = [];
    const mockPi = {
      getActiveTools: () => ["ask_advisor"],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      registerEntryRenderer: () => undefined,
      registerMessageRenderer: () => undefined,
      setActiveTools: () => undefined,
      setModel: () => Promise.resolve(true),
      setThinkingLevel: () => undefined,
    } as unknown as ExtensionAPI;

    try {
      registerCommands(mockPi);
      await commands.get("advisor").handler("executor=missing/model", {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          find: (provider: string) =>
            provider === "missing" ? undefined : { id: "x", provider },
          getApiKeyAndHeaders: () =>
            Promise.resolve({ apiKey: "key", ok: true }),
        },
        ui: { notify: (message: string) => notes.push(message) },
      } as any);

      expect(notes.join("\n")).toContain("Executor model not found");
      await commands.get("advisor-off").handler("", {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        ui: { notify: () => undefined },
      } as any);
      expect(
        JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"))
          .executor
      ).toBe("good/executor");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});
