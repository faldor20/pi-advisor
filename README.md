# pi-advisor

<div align="center">
  <img src="https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/screenshot.png" alt="Pi Advisor consultation in the terminal" width="760">

A configurable second-opinion workflow for <a href="https://github.com/earendil-works/pi">Pi</a> coding agents.

</div>

Keep the work to the executor model, while the advisor steers it.

This extension introduces a strategic "Executor/Advisor" workflow, inspired by Claudes [Advisor](https://code.claude.com/docs/en/advisor).

`pi-advisor-flow` keeps one model focused on execution and makes a second, smarter model available for consequential decisions, stalled work, and final reviews. The Executor still owns the work. The Advisor provides a concise review, answers questions and can provide help; it does not take over planning or run tools.

[Read more about Advisors here](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## Install

Install into your Pi agent environment:

```bash
# npm
pi install npm:pi-advisor-flow

# GitHub
pi install git:github.com/philipbrembeck/pi-advisor.git

# local checkout, useful during development
pi install /path/to/pi-advisor
```

Restart or reload Pi after installation, then run `/advisor` in a session.

## Start using it

1. Run `/advisor` to enable the flow and register `ask_advisor`.
2. Run `/advisor-models` to choose the Executor and Advisor models.
3. Run `/advisor-settings` to set Simple mode, persistent activation, context, gates, privacy controls, and output limits.

Enable with models in one command when preferred:

```text
/advisor executor=anthropic/claude-sonnet-5 advisor=openai/gpt-5.6-sol
```

`/advisor contextMaxChars=30000` sets the reconstructed-context limit for the current session. Use `0` for no history. The `ALL` option in settings represents the complete current branch and is still subject to the Advisor model's context limit.

## Commands

| Command                   | Purpose                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/advisor`                | Enable the flow, select the configured Executor, and register `ask_advisor`. Accepts `executor=`, `advisor=`, and `contextMaxChars=` overrides. |
| `/advisor-manual [focus]` | Start a parallel Advisor consultation without interrupting the current Executor turn.                                                           |
| `/advisor-models`         | Choose Executor and Advisor models plus their reasoning effort.                                                                                 |
| `/advisor-settings`       | Open all Advisor settings in one keyboard-navigable screen.                                                                                     |
| `/advisor-off`            | Disable the flow and remove `ask_advisor` from the active session.                                                                              |

### `ask_advisor`

The Executor calls `ask_advisor({})` for a general review of the current task and reconstructed conversation. It can pass a `question` for a targeted review.

Use the Advisor after the Executor has investigated and formed a candidate direction. It is intended to challenge assumptions, expose risks, and confirm the next verification step—not to replace the Executor's work.

Normal consultations preserve the provider's final Markdown and never block execution. When the Advisor has no material concern or recommendation, it may begin with the exact first line `Verdict: sound`; Pi renders that response with the static `◆ ADVISOR · SOUND` header, for both `ask_advisor` results and `/advisor-manual`.

## Automatic loop gate

The optional loop gate detects consecutive calls with the same normalized tool signature. By default, it consults the Advisor after three repeats.

Unlike ordinary consultations, a loop-gate reply must start with exactly one decision header:

```text
Decision: proceed
Decision: revise
Decision: blocked
```

| Decision  | Effect                                              |
| --------- | --------------------------------------------------- |
| `proceed` | Reset the repeat counter and allow the tool action. |
| `revise`  | Block the repeated tool action.                     |
| `blocked` | Apply the configured gate-failure policy.           |

Malformed, missing, duplicate, or contradictory decisions are gate failures. The same policy also applies when the Advisor is unavailable or the shared call budget is exhausted.

| Failure mode              | Effect                              |
| ------------------------- | ----------------------------------- |
| `block-session` (default) | Block the session.                  |
| `block-tool`              | Block only the current tool action. |
| `warn-and-continue`       | Show a warning and continue.        |

| Condition                                                | `block-session` | `block-tool`      | `warn-and-continue` |
| -------------------------------------------------------- | --------------- | ----------------- | ------------------- |
| Advisor unavailable or timed out                         | Block session   | Block tool action | Warn and continue   |
| Missing, malformed, duplicate, or contradictory decision | Block session   | Block tool action | Warn and continue   |
| Shared budget exhausted                                  | Block session   | Block tool action | Warn and continue   |
| `Decision: blocked`                                      | Block session   | Block tool action | Warn and continue   |

`advisorBlockOnBlocked` controls whether a session block immediately aborts the active run. It never turns a session block into a tool-only block.

## Settings and configuration

`/advisor-models` and `/advisor-settings` save to `advisor.json` in the Pi agent directory. If a trusted project already has its own configuration, Pi uses that file instead.

All fields are optional. This example shows the available settings and their normal defaults:

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
  "advisorToolPolicies": {
    "bash": "summary",
    "deploy": "exclude"
  }
}
```

### Simple mode and persistent activation

- `simpleMode` defaults to `false`. When enabled, `ask_advisor` and `/advisor-manual` remain available for voluntary second opinions, while plan/failure/completion rules, loop gates, blocking, call budgets, and session summaries are disabled. Context limits, result caps, redaction, and tool disclosure policies still apply.
- `alwaysOn` defaults to `false`. When enabled, Pi restores the configured Executor and activates `ask_advisor` for new, resumed, forked, and reloaded sessions. While the Advisor flow is active, an explicit `/model` selection becomes the persisted Executor for the next activation; a model restored with a session does not change the saved Executor. `/advisor-off` turns `alwaysOn` off so the flow stays disabled in later sessions.
- In Simple mode, settings keeps the Context window/history slider alongside Simple mode and Always on; advanced values remain saved and take effect when Simple mode is disabled.

### Repository context

- `advisorGitContext` defaults to `summary`. It controls how much of the working tree reaches the Advisor:
  - `off` sends no repository information.
  - `summary` sends changed file names, change status, and line counts. It never sends file contents.
  - `full` additionally sends the patch.
- Changes are measured against the last commit and cover staged and unstaged work. Untracked files are always listed by name only; their contents are never sent.
- `advisorGitContextMaxChars` defaults to `20000`. Repository context may claim its own cap or half of `contextMaxChars`, whichever is smaller, so it cannot crowd out the conversation.
- The Executor may pass `gitContext` to `ask_advisor` as `none`, `summary`, or `full`. `advisorGitContext` is the ceiling: a larger request is narrowed to the configured level and the Advisor is told that a fuller view was withheld, so it does not claim verification it could not perform.
- `summary` deliberately excludes diff hunk headers. Git derives those from surrounding file content, so a hunk header can reproduce a line the change never touched, including a credential.
- Redaction runs before the region is capped, and repository content is labelled as untrusted data in the request. Paths and patch text are escaped so a crafted path cannot close the region early and have the remainder read as instructions.
- File names themselves can be sensitive. `summary` withholds file contents, not file names; use `off` when names must not leave the machine.
- Collection shares a single overall time budget across its git commands and degrades to a stated failure rather than implying a clean tree.

### Context and limits

- `contextMaxChars` defaults to `15000`. It preserves complete semantic entries and adds an omission marker rather than splitting a message.
- Set `contextMaxChars` to `0` to omit reconstructed history. `9007199254740991` is the persisted value for `ALL`.
- Tool results default to Pi's `2000` lines and `50 KiB` limits. Oversized results preserve their beginning and end with an omission marker.
- `advisorLoopThreshold` is an integer of at least `2`; its default is `3`.
- Omit `advisorMaxCallsPerSession` for an unlimited shared budget. Otherwise it must be a non-negative safe integer.

### Privacy controls

Advisor context can contain user messages, tool calls, and tool results. Configure disclosure deliberately:

- `advisorRedactSecrets` defaults to `false`. When enabled, pi-advisor locally redacts common credential patterns before including context in an Advisor request.
- `advisorToolPolicies` matches an **exact tool name**. Each tool may use `full`, `summary`, or `exclude`.
  - `full` includes the call arguments and capped result output.
  - `summary` omits call arguments and result output but includes result status and size metadata.
  - `exclude` omits both call details and output.
- Tools not listed in `advisorToolPolicies`, including custom and newly added tools, use `full` for backward compatibility.

Redaction and output limits reduce accidental disclosure; they are not a data-classification system and cannot guarantee every secret is found. Use tool policies for content that must not be sent to the Advisor.

### Session summary and Herdr

The optional Session Advisor Summary defaults to off. When enabled, it is local and in-memory only, appears after a non-blocked settled run, and is never persisted.

It distinguishes regular Markdown advice from gate decisions and records the trigger, model, usage/cost when available, failures, budget, and execution effect.

[Herdr](https://github.com/ogulcancelik/herdr) integration is enabled by default. It reports Advisor activity and blocked state through Herdr's metadata paths; disable it with `advisorHerdrIntegration`.

## Development

```bash
git clone git@github.com:philipbrembeck/pi-advisor.git
cd pi-advisor
bun install

bun test
bun run typecheck
bun run lint
```

## Links

- [MIT LICENSE](LICENSE)
- [Changelog](CHANGELOG.md)
- [npm package](https://www.npmjs.com/package/pi-advisor-flow)
- [Why use an Advisor flow?](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need)
