# Configuration

Use `/advisor-models` and `/advisor-settings` to configure pi-advisor. Both commands save to the global `advisor.json` in the Pi agent directory.

Repository-controlled project `advisor.json` files are not applied. Models, prompts, gates, budgets, disclosure, redaction, integrations, and consent remain under the user's global configuration.

`/advisor` also accepts `executor=`, `advisor=`, and `contextMaxChars=` overrides for the current activation. For example, `/advisor contextMaxChars=30000` sets the reconstructed-history limit; use `0` for no history. The `ALL` option in settings represents the complete current branch and remains subject to the Advisor model's context limit.

All fields are optional. This example shows the available settings and their normal defaults. Disclosure and redaction fields are explained in [Privacy and data handling](privacy.md).

```json
{
  "executor": "openai/gpt-5.6-luna",
  "advisor": "anthropic/claude-fable-5",
  "executorEffort": "medium",
  "advisorEffort": "xhigh",
  "contextMaxChars": 25000,

  "advisorPlanGate": true,
  "advisorFailureGate": true,
  "advisorCompletionGate": true,
  "advisorCustomInvocation": "before changing a production deployment",
  "advisorCollapseResponses": false,

  "advisorAutoLoopGate": true,
  "advisorLoopThreshold": 3,
  "advisorMaxCallsPerSession": 5,
  "advisorBlockOnBlocked": true,
  "gateFailureMode": "block-session",

  "advisorSessionSummary": false,
  "advisorGitContext": "summary",
  "advisorGitContextMaxChars": 20000,
  "simpleMode": false,
  "alwaysOn": false,
  "advisorHerdrIntegration": true,
  "advisorToolResultMaxLines": 2000,
  "advisorToolResultMaxBytes": 51200,

  "advisorRedactSecrets": false,
  "advisorTrackedFileContent": false,
  "advisorUntrackedContent": false,
  "advisorOutcomeLogging": false,
  "advisorToolPolicies": {
    "bash": "summary",
    "deploy": "exclude"
  }
}
```

## Simple mode and persistent activation

- `simpleMode` defaults to `false`. When enabled, `ask_advisor` and `/advisor-manual` remain available for voluntary second opinions, while plan/failure/completion rules, loop gates, blocking, call budgets, and session summaries are disabled. Context limits, result caps, redaction, and tool disclosure policies still apply.
- `alwaysOn` defaults to `false`. When enabled, Pi restores the configured Executor and activates `ask_advisor` for new, resumed, forked, and reloaded sessions.
- While the Advisor flow is active, an explicit `/model` selection becomes the persisted Executor for the next activation. A model restored with a session does not change the saved Executor.
- `/advisor-off` turns `alwaysOn` off so the flow stays disabled in later sessions.
- In Simple mode, settings keeps the Context window/history slider alongside Simple mode and Always on. Advanced values remain saved and take effect when Simple mode is disabled.

## Context and limits

- `contextMaxChars` defaults to `15000`. It preserves complete semantic entries and adds an omission marker rather than splitting a message.
- Set `contextMaxChars` to `0` to omit reconstructed history. `9007199254740991` is the persisted value for `ALL`.
- Tool results default to Pi's `2000` lines and `50 KiB` limits. Oversized results preserve their beginning and end with an omission marker.
- `advisorLoopThreshold` is an integer of at least `2`; its default is `3`.
- Omit `advisorMaxCallsPerSession` for an unlimited shared budget. Otherwise it must be a non-negative safe integer.

## Consultation responses

Normal consultations preserve the provider's final Markdown and never block execution. If the Advisor explicitly says it cannot review a specifically named file, the Executor may make a sequential follow-up call with `includeTrackedFiles` when global tracked-file consent is enabled; this is discretionary, not an automatic retry. When the Advisor has no material concern or recommendation, it may begin with the exact first line `Verdict: sound`. Pi renders that response with the static `◆ ADVISOR · SOUND` header for both `ask_advisor` results and `/advisor-manual`.

## Automatic loop gate

The optional loop gate detects consecutive calls with the same normalized tool signature. By default, it consults the Advisor after three repeats.

Unlike ordinary consultations, a loop-gate reply must start with exactly one decision header:

```text
Decision: proceed
Decision: revise
Decision: blocked
```

| Decision | Effect |
| --- | --- |
| `proceed` | Reset the repeat counter and allow the tool action. |
| `revise` | Block the repeated tool action. |
| `blocked` | Apply the configured gate-failure policy. |

Malformed, missing, duplicate, or contradictory decisions are gate failures. The same policy applies when the Advisor is unavailable or the shared call budget is exhausted.

| Failure mode | Effect |
| --- | --- |
| `block-session` (default) | Block the session. |
| `block-tool` | Block only the current tool action. |
| `warn-and-continue` | Show a warning and continue. |

| Condition | `block-session` | `block-tool` | `warn-and-continue` |
| --- | --- | --- | --- |
| Advisor unavailable or timed out | Block session | Block tool action | Warn and continue |
| Missing, malformed, duplicate, or contradictory decision | Block session | Block tool action | Warn and continue |
| Shared budget exhausted | Block session | Block tool action | Warn and continue |
| `Decision: blocked` | Block session | Block tool action | Warn and continue |

`advisorBlockOnBlocked` controls whether a session block immediately aborts the active run. It never turns a session block into a tool-only block. A recorded session block remains fail-safe after `/advisor-off`; start a new session to resume tool execution.

See [Privacy and data handling](privacy.md) for repository context, disclosure, redaction, and integrations.
