# pi-advisor

<div align="center">

![Pi Advisor consultation in the terminal](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/screenshot.png)

A configurable second-opinion workflow for <a href="https://github.com/earendil-works/pi">Pi</a> coding agents, inspired by the ["Steering Black-Box LLMs with Advisor Models" paper](https://arxiv.org/abs/2510.02453) and Claude's [Advisor](https://code.claude.com/docs/en/advisor) feature.

</div>

`pi-advisor-flow` keeps one model focused on execution and makes a second, smarter model available for consequential decisions, stalled work, and final reviews. The Executor still owns the work. The Advisor challenges assumptions, exposes risks, and suggests verification steps without taking over or running tools.

The idea is simple: keep implementation on a fast model and borrow frontier reasoning only when decisions matter. [Read why this workflow is useful](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## Features

- **On-demand second opinions** through the `ask_advisor` tool or `/advisor-manual`.
- **Configurable review gates** before plans, after repeated failures, and before declaring completion.
- **Automatic loop detection** for repeated tool calls, with explicit proceed, revise, or blocked decisions.
- **Separate model and reasoning controls** for the Executor and Advisor.
- **Privacy controls** for conversation history, repository context, tool results, secret redaction, and outcome logging.
- **Optional persistent activation, Simple mode, session summaries, and Herdr integration.**

## Install

Requires Pi 0.80.7 or later. The extension installs no dependencies of its own; Pi supplies its runtime modules.

```bash
# npm
pi install npm:pi-advisor-flow

# GitHub
pi install git:github.com/philipbrembeck/pi-advisor.git

# local checkout
pi install /path/to/pi-advisor
```

Restart or reload Pi after installation.

## Quick start

1. Run `/advisor` to enable the flow and register `ask_advisor`.
2. Run `/advisor-models` to choose the Executor and Advisor models.
3. Run `/advisor-settings` to configure review gates, context, privacy, and limits.

You can also enable the flow and select both models at once:

```text
/advisor executor=anthropic/claude-sonnet-5 advisor=openai/gpt-5.6-sol
```

## How it works

1. The Executor investigates the task and forms its own candidate direction.
2. For a consequential decision, stalled attempt, or final review, it calls `ask_advisor` with the reconstructed conversation and allowed repository context.
3. The Advisor returns a concise review. It may challenge assumptions, identify risks, or recommend the next verification step.
4. The Executor decides what to adopt, performs the work, and validates the result.

A normal consultation never blocks execution. The optional automatic loop gate is different: it evaluates repeated tool calls and applies the configured failure policy when the Advisor says to revise, reports a block, is unavailable, or returns an invalid decision.

Successful calls return an opaque `adviceId`. If global outcome logging is enabled, the Executor can call `record_advisor_outcome` once to record whether the advice was adopted and whether final validation passed.

## Commands

| Command | Purpose |
| --- | --- |
| `/advisor` | Enable the flow and optionally override the Executor, Advisor, or context limit. |
| `/advisor-manual [focus]` | Start a parallel consultation without interrupting the current Executor turn. |
| `/advisor-models` | Choose both models and their reasoning effort. |
| `/advisor-settings` | Configure behavior, context, gates, privacy, and output limits. |
| `/advisor-off` | Disable the flow and turn off persistent activation. |

The Executor calls `ask_advisor({})` for a general review. It can pass a targeted `question` or a concise `draft` describing proposed work, validation, and remaining risks. Draft claims give the Advisor review context; they are not verification evidence.

## What gets sent to the Advisor

Advisor context can include user messages, tool calls, tool results, and repository information. Secret redaction is off by default, and tools without an explicit disclosure policy default to full context. Review the privacy settings before using the extension with sensitive work.

Repository context is configurable from no access through changed-file summaries to a capped patch. Untracked file contents require a separate explicit opt-in.

## Documentation

- [Configuration and automatic loop gates](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md)
- [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md)
- [Development](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/development.md)
- [Documentation index](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/README.md)

## Links

- [MIT License](LICENSE)
- [Changelog](CHANGELOG.md)
- [npm package](https://www.npmjs.com/package/pi-advisor-flow)
- [Why use an Advisor flow?](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need)
