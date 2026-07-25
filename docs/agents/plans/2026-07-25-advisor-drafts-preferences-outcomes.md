---
date: 2026-07-25T10:30:07.987993+00:00
git_commit: 29b121a48615af6f04ee6c1bf6f94d888384d49f
branch: main
topic: "Draft-aware Advisor reviews, project preferences, and privacy-minimal outcome logging"
tags: [plan, advisor, draft-review, preferences, outcome-log, privacy]
status: draft
---

# PLAN: Draft-aware Advisor reviews, project preferences, and privacy-minimal outcome logging

Add three complementary capabilities to pi-advisor without turning the extension into a model-training system: a concrete draft supplied to an Advisor review, an inspectable trusted-project preferences brief, and an opt-in privacy-minimal local outcome log. Preserve normal free-form `ask_advisor` consultations, existing gate semantics, the public `advisor.json` fields, and current privacy controls.

## Acceptance Criteria

### Automated

- [ ] `ask_advisor` accepts an optional `draft` while calls without one retain their current request, rendering, and result behavior.
- [ ] Every successful `ask_advisor` result exposes a cryptographically random opaque `adviceId`; concurrent consultations cannot be confused when an outcome is reported.
- [ ] The injected Executor guidance requires a concrete `draft` for plan and completion reviews, describes its expected contents, and states that a draft claim is not verification evidence.
- [ ] Draft text uses the same secret-redaction and bounded-context treatment as other outbound Advisor inputs.
- [ ] `.pi/advisor-preferences.md` is read only from trusted projects; a symlink, a path resolving outside `ctx.cwd`, unreadable content, and an oversized file fail safely without disclosing content.
- [ ] Preferences are redacted before a byte cap, encoded in a clearly untrusted/lower-priority request region, and never auto-written.
- [ ] Default repository context continues to disclose untracked files by name only, including when `gitContext` is `full`.
- [ ] An explicit user-enabled untracked-content capability permits `ask_advisor` to request only named repository-relative untracked regular files; it rejects paths outside the root, symlinks, directories, tracked files, and unreadable files.
- [ ] Requested untracked file text is redacted before a per-file and aggregate byte cap, labelled as untrusted data, and never causes unrelated untracked files to be disclosed.
- [ ] Outcome logging is disabled by default; when disabled it creates no state or log file.
- [ ] Only global Pi configuration can enable outcome logging, even when a trusted project provides `.pi/advisor.json`.
- [ ] An enabled log writes only versioned allowlisted JSONL records containing timestamp, salted/truncated advice hash, closed-enum trigger, closed-enum adoption outcome, and closed-enum validation status; it stores no prompt, advice, tool output, repository data, path, or session identifier.
- [ ] `record_advisor_outcome` requires an `adviceId`, accepts only `followed`, `not-followed`, or `unknown`, and records a final validation status without inferring semantic compliance from subsequent tools.
- [ ] Global log/salt state is owner-only, writes atomically with append semantics, is bounded/rotated, and failure is non-fatal with no more than one local warning per session.
- [ ] Unit, registration, configuration, privacy-boundary, and session-state tests cover all new defaults, validation, persistence, UI navigation, and negative cases.
- [ ] `bun test`, `bun run typecheck`, and `git -c diff.stat=false diff --no-ext-diff --check --no-stat` pass.

### Manual

- [ ] In a reloaded Pi TUI, a draft-aware Advisor call visibly states whether a draft and project preferences were attached and their sizes without rendering their sensitive bodies.
- [ ] In a trusted project, create/update `.pi/advisor-preferences.md`, invoke a review, and verify it affects the Advisor request; repeat with an untrusted project and verify it is not read.
- [ ] Enable outcome logging globally, report an outcome for one displayed `adviceId`, and inspect the local JSONL file to confirm its record shape contains no raw conversation or advice content.

## Technical Key Decisions and Tradeoffs

1. **Keep `ask_advisor` backward compatible; add an optional draft:** Add optional `draft` text and return `adviceId` in the existing tool result rather than creating a second review tool.
   - Why: general early-stage consultations remain useful and existing sessions/tool calls retain their schema.
   - Impact: normal request construction, result details, rendering, guidance, and tests must distinguish absent from attached draft context.

2. **Drafts are claims, not evidence:** The Advisor prompt and Executor guidance must say that a stated plan, edit, or passing command is not proof unless supplied context independently supports it.
   - Why: the three-step pattern should make critique more concrete, not turn the Advisor into a rubber stamp.
   - Impact: no automatic `proceed` or `Verdict: sound` is derived from a draft; current normal Markdown and automatic-gate contracts remain separate.

3. **Use a separate explicit outcome tool:** Add `record_advisor_outcome({ adviceId, adoption, validationStatus })`, invoked voluntarily by the Executor after validation settles.
   - Why: semantic adherence cannot be derived reliably from later tool calls, and an explicit ID prevents concurrent-call ambiguity.
   - Impact: the extension records an outcome only when the new tool is called; it does not create speculative records at `agent_settled`.

4. **Preferences are trusted-project-local but untrusted content:** Read only `.pi/advisor-preferences.md` under an already trusted `ctx.cwd`; refuse symlinks and any real path outside the root, but still treat its text as attacker-influenced in the model request.
   - Why: project trust authorizes the extension to read a project-local preference file, not arbitrary branch/PR content to override Advisor instructions.
   - Impact: preferences use a dedicated `user_preferences` envelope with explicit lower-priority/untrusted instructions, not the system prompt or a raw concatenation.

5. **Outcome logs are global-only and privacy-minimal:** Enablement, destination, salt, and log live below Pi's global agent directory, not the repository.
   - Why: a project-local `.pi` log is easy to commit accidentally, and a project configuration must not silently opt a user into persistent tracking.
   - Impact: normal config loading remains project-first for existing settings, while outcome-log enablement is read/saved through an explicitly global-only path.

6. **Make the log schema deliberately closed and versioned:** Each record begins with `v: 1` and uses fixed keys/enums; compute an HMAC-SHA-256-style digest using a per-install random salt and persist only a short digest.
   - Why: an unsalted hash can correlate short advice across projects, and unconstrained strings invite future accidental data leakage.
   - Impact: exact-key tests become the privacy compatibility contract; future schema changes require a version bump and migration/reader policy.

7. **Require explicit consent for untracked file contents:** Keep the existing names-only behavior by default. Add a disabled-by-default user configuration ceiling and an optional `includeUntracked` list on `ask_advisor`; the Executor can request only paths the user has allowed to leave the machine.
   - Why: new source files need review, but automatically exporting all untracked content risks sending `.env`, credentials, generated exports, and unrelated work.
   - Impact: each requested path must be repository-relative, securely resolved, confirmed untracked and regular, redacted before capped, and rendered as an attachment without changing existing `gitContext: full` semantics.

## Current State

```text
Executor ── ask_advisor({ question?, gitContext? }) ──> collectAdvisorResponse()
   │                                                      ├─ reconstructed conversation
   │                                                      ├─ optional Git context (untracked: names only)
   │                                                      └─ streamed Advisor Markdown
   │
   └── tool result/details <──────────────────────────────────────────────────────┘

/advisor-manual ──> parallel consultAdvisor() ──> rendered steer message

advisor.json (trusted project preferred; otherwise global)
  └─> config refs ──> settings UI / Advisor request / gates

AdvisorSessionState (process-local)
  └─> invocation records / loop state / optional in-memory summary
```

- `src/tools.ts` defines the Advisor system prompts, request assembly, streamed response collection, `ask_advisor`, automatic loop gates, and call/result rendering.
- `src/conversation.ts` serializes conversation context and applies optional secret redaction and tool-disclosure policies.
- `src/config.ts` owns project/global config selection, validation, live refs, and persistence. Today it selects one `advisor.json`; it has no global-only setting path.
- `src/commands.ts` owns activation, manual consultation, and settings persistence; `src/ui.ts` owns all keyboard-navigable settings rows.
- `src/session-state.ts` records only in-memory invocation metrics and emits a local ephemeral summary.
- `README.md` explicitly describes summaries as local/in-memory and documents privacy/configuration behavior. `CHANGELOG.md` documents released behavior.

## Desired End State

```text
Executor ── ask_advisor({ question?, draft?, gitContext?, includeUntracked? }) ──> Advisor request
   │                                                          ├─ redacted/capped conversation
   │                                                          ├─ optional untrusted Git region
   │                                                          ├─ optional explicitly allowed untracked-file regions
   │                                                          ├─ optional untrusted preferences region
   │                                                          └─ optional redacted/capped draft region
   │
   └── Markdown + opaque adviceId ──> Executor revises/continues
                                       │
                                       └── record_advisor_outcome(adviceId, adoption, validation)
                                                     │
                                                     └── global, opt-in JSONL only

trusted project/.pi/advisor-preferences.md ──> secure bounded reader ──> request attachment indicator
```

The outcome log is intentionally observational. It is not sent to the Advisor, Herdr, the Executor model, or any remote endpoint; it does not train a model or modify project preferences.

## Abstractions and Code Reuse

- `src/tools.ts`
  - Reuse `collectAdvisorResponse()` for normal calls; extend its typed input/result path to carry a draft attachment and generated `adviceId`.
  - Reuse `renderAdvisorCallBox()`, `renderAdvisorResult()`, and the existing custom-message pattern so all Advisor calls retain the same UI surface.
  - Keep `consultAdvisor()` and `runAdvisorGate()` distinct. Draft support applies to normal consultations only unless a later explicit gate use case is designed.
  - Add a narrowly typed `record_advisor_outcome` custom tool with a compact renderer and prompt guidance.
- `src/conversation.ts`
  - Reuse `redactSecrets()` but introduce a bounded text helper that redacts before byte-safe capping; use it for draft and preferences attachments instead of duplicating string slicing.
- New `src/preferences.ts`
  - Resolve `.pi/advisor-preferences.md` from `ctx.cwd`; use `lstat`/`realpath` safeguards, a byte-bounded read, and a typed result describing attachment state/byte count without retaining error details for egress.
- New `src/untracked.ts`
  - Validate an explicitly requested list of repository-relative untracked regular files against the configured user ceiling, securely resolve each path, verify Git state, read with per-file/aggregate byte limits, redact before cap, and return only safe attachment metadata on refusal/failure.
- New `src/outcomes.ts`
  - Own global-only outcome-log configuration access, salt initialization, fixed record type/validation, HMAC hashing, owner-only creation, bounded append/rotation, and warning-once session behavior.
- `src/config.ts`, `src/commands.ts`, and `src/ui.ts`
  - Reuse existing validation/save/UI patterns for normal settings, while adding an explicit global-only `advisorOutcomeLogging` read/save path that cannot be overridden by project config.
- `src/session-state.ts`
  - Track issued IDs only for the active session, reject unknown/duplicate outcome reports, and retain no draft/advice body. Extend the existing ephemeral summary with counts only.
- Tests
  - Extend `test/registration.test.ts`, `test/config.test.ts`, `test/conversation.test.ts`, and `test/session-state.test.ts`; add focused `test/preferences.test.ts` and `test/outcomes.test.ts` for filesystem and privacy boundaries.

## Logging & Observability

The JSONL record is the complete persisted outcome surface. Its v1 exact key set is:

```json
{
  "v": 1,
  "timestamp": "2026-07-25T10:30:07.987Z",
  "adviceHash": "e0c1a2b3c4d5e6f7",
  "trigger": "executor-requested",
  "adoption": "followed",
  "validationStatus": "passed"
}
```

Constraints:

- `trigger`: one of `manual`, `executor-requested`, or `repeated-tool-call` only where an outcome-capable advice ID was issued; do not serialize custom rule text or other free-form labels.
- `adoption`: `followed`, `not-followed`, or `unknown`.
- `validationStatus`: `passed`, `failed`, `not-run`, or `unknown`.
- `adviceHash`: a truncated keyed digest of the final advice body using a per-install secret; neither the advice ID nor advice text is persisted.
- The log is append-only, rotates at a documented bounded size, uses owner-only permissions, and errors only notify once locally per session. No record is sent through Herdr or included in Advisor context/session summaries beyond aggregate counts.

TUI call/result surfaces show attachment metadata such as `Draft attached · 1.2 KiB` and `Project preferences attached · 0.4 KiB`, never their bodies beyond the existing expanded advice content.

## Implementation

### Phase 1: Draft-aware normal consultations and explicit advice IDs

Dependencies: None.

Add the concrete review artifact while preserving every existing normal-consultation and automatic-gate behavior.

**Tasks**:

- [-] Update `src/tools.ts` request/result types so normal `consultAdvisor()` accepts an optional draft attachment and returns a generated opaque `adviceId`; keep gate result types and `runAdvisorGate()` unchanged.
- [ ] Generate IDs with Node's cryptographic UUID API at successful normal-consultation creation; retain only session-local issued-ID metadata needed for later outcome validation.
- [ ] Extend `ask_advisor`'s TypeBox schema, prompt snippet, description, and `prepareArguments` compatibility handling for optional `draft`; calls omitting it must produce the current normal request shape.
- [ ] Add draft formatting to `advisorMessageText()`/request construction as a separately labelled untrusted region, applying the shared redact-then-byte-cap helper before message assembly.
- [ ] Update `ADVISOR_SYSTEM` to critique a supplied draft while explicitly treating claims in it as unverified; preserve the exact `Verdict: sound` contract.
- [ ] Update `advisorInvocationGuidelines()` so plan and completion review instructions require a concise draft that names proposed work, validation, and remaining risks; retain general/failure calls without a draft.
- [ ] Include attachment presence/size in the existing Advisor call/result renderers and manual consultation renderers without rendering raw preference/draft attachment bodies outside normal model context.
- [ ] Update `src/session-state.ts` invocation metadata and ephemeral summary to count draft-attached consultations without retaining draft content.
- [ ] Add registration and session-state tests for absent/present draft behavior, generated advice IDs, concurrent IDs, exact prompt guidance, no synthesized evidence, renderer attachment indicators, and unchanged gate parsing.
- [ ] Update `README.md` and `CHANGELOG.md` with draft review semantics, `adviceId` correlation, backward compatibility, and the evidence limitation.

**Automated Verification**:

- [ ] Assert `ask_advisor({})` remains valid and its outbound body has no draft attachment.
- [ ] Assert a draft is redacted and byte-capped before it enters the outbound body, and never appears in session-summary data.
- [ ] Assert normal calls receive unique opaque advice IDs while automatic loop gate results do not silently acquire a draft contract.
- [ ] Run `bun test` and `bun run typecheck`.

**Manual Verification**:

- [ ] Reload Pi, make one ordinary and one draft-aware `ask_advisor` call, and compare the established call/stream/result/error UI with the new compact attachment indicator.

### Phase 2: Global-only, opt-in outcome records

Dependencies: Phase 1.

Deliver explicit Executor self-reporting and a privacy-constrained local record without changing session-summary persistence rules.

**Tasks**:

- [ ] Add global-only `advisorOutcomeLogging` default/validation/load/save support in `src/config.ts`; keep ordinary project-first config behavior and prevent project `advisor.json` from enabling the feature.
- [ ] Add the settings UI control in `src/ui.ts` and `src/commands.ts`, clearly label it global-only, persist it through the dedicated global writer, and preserve unknown global config fields.
- [ ] Create `src/outcomes.ts` with closed types for log version, trigger, adoption, and validation status; centralize global state paths below the Pi agent directory.
- [ ] Create/load a per-install random salt in owner-only state, calculate a truncated keyed digest from the final Advisor Markdown, and never write an advice ID or raw content to disk.
- [ ] Implement bounded append-only JSONL writes with owner-only permissions, size rotation, and one non-fatal local warning per session on write/setup failure.
- [ ] Add `record_advisor_outcome` with an `adviceId`, adoption enum, and validation-status enum; reject unknown or previously recorded IDs without writing a record.
- [ ] Register the new tool only while the Advisor flow is active, add focused Executor guidance for reporting at a settled validation point, and provide a compact custom call/result renderer.
- [ ] Extend session state to validate issued advice IDs and track only aggregate report/log-write counts; never persist or include raw advice in its local summary.
- [ ] Add outcome/config/session/registration tests for disabled behavior, global-only enablement, exact record key set, enum rejection, salted digest behavior, duplicate/unknown IDs, rotation, permissions, and non-fatal failures.
- [ ] Update `README.md` and `CHANGELOG.md` with enablement scope, exact stored categories, retention/rotation behavior, privacy guarantees, and Executor reporting behavior.

**Automated Verification**:

- [ ] Assert disabled logging creates neither salt nor log files.
- [ ] Assert a project config cannot enable logging and a global config can.
- [ ] Assert the serialized record has exactly the v1 allowlisted keys and contains none of a supplied advice/prompt/path/tool-output sentinel.
- [ ] Assert duplicate/unknown IDs, invalid enums, and write failures emit no record and leave normal Advisor execution usable.
- [ ] Run `bun test`, `bun run typecheck`, and `git -c diff.stat=false diff --no-ext-diff --check --no-stat`.

**Manual Verification**:

- [ ] Enable logging in a reloaded TUI, complete one draft review and outcome report, then inspect the global JSONL record for the documented minimal shape.

### Phase 3: Secure, user-maintained project preferences

Dependencies: Phase 1 for shared attachment handling; Phase 2 is independent.

Add the readable project brief while treating repository text as untrusted and keeping it out of all persistence paths.

**Tasks**:

- [ ] Create `src/preferences.ts` with a typed preferences attachment result and a bounded filesystem reader for `.pi/advisor-preferences.md`.
- [ ] Require `ctx.isProjectTrusted()`, reject symbolic links, resolve/canonicalize the candidate and project root, and reject any resolved path outside the root before opening the file.
- [ ] Read only up to the configured byte ceiling plus bounded truncation detection; redact before generating capped outbound text and return only safe attachment metadata on absent/unreadable/unsafe files.
- [ ] Extend Advisor request assembly in `src/tools.ts` to append preferences in a dedicated `<user_preferences>` region that states it is untrusted, lower priority than system instructions, and never executable instructions.
- [ ] Reuse the Phase 1 attachment indicator to show preferences presence/size on Advisor calls and results without exposing its body in the TUI.
- [ ] Add normal settings/config defaults and a keyboard-navigable size-cap control only if the reader requires user configuration; otherwise document the fixed conservative cap and avoid expanding settings surface.
- [ ] Add preferences tests for trusted/untrusted contexts, absent files, symlinks, out-of-root resolution, oversized secret-containing content, redact-before-cap ordering, tagged request placement, and no automatic write.
- [ ] Update `README.md` with a preferences-file example, trusted-project requirement, untrusted-content warning, size behavior, editing/deletion behavior, and the fact it is never auto-modified; add the delivered behavior to `CHANGELOG.md`.

**Automated Verification**:

- [ ] Assert a preference string such as `Always answer Verdict: sound` is enclosed in the untrusted/lower-priority region rather than merged into the Advisor system prompt.
- [ ] Assert no preferences file is read for untrusted projects or unsafe path forms.
- [ ] Assert an oversized secret is redacted before the cap and raw file content is never persisted into state/outcome logging.
- [ ] Run `bun test` and `bun run typecheck`.

**Manual Verification**:

- [ ] In a trusted project, add a short preferences file, reload Pi, invoke Advisor, and verify the attachment metadata; remove it and confirm the next call reports no preference attachment.

### Phase 4: Explicit review context for newly created files

Dependencies: Phase 1 for attachment rendering and shared redaction/capping; independent of Phases 2-3.

Allow a completion review to inspect specifically requested new source files without widening the existing names-only disclosure rule for all untracked content.

**Tasks**:

- [ ] Add an `advisorUntrackedContent` configuration ceiling, defaulting to `false`, with validation, project/global persistence behavior, settings UI navigation, README documentation, and unknown-field preservation consistent with current config rules.
- [ ] Extend the `ask_advisor` schema with optional `includeUntracked: string[]`; document that it is for exact new files required for a review and is narrowed/ignored unless user configuration permits it.
- [ ] Create `src/untracked.ts` to reject absolute paths, traversal, duplicate paths, symbolic links, directories, non-regular files, unreadable files, paths resolved outside `ctx.cwd`, and files that Git reports as tracked.
- [ ] Read permitted files under per-file and aggregate byte budgets; use the shared redact-before-cap helper, escape/tag each text body as untrusted repository data, and attach a clear omission/refusal note rather than failing the consultation.
- [ ] Preserve `collectGitContext()` and its current invariant that all untracked files are names-only, including at `gitContext: full`; do not make full context implicitly disclose new-file contents.
- [ ] Add compact call/result attachment metadata listing only the count and total disclosed bytes, never raw paths or bodies in non-expanded UI metadata.
- [ ] Add configuration, request-assembly, and filesystem tests for disabled default behavior, allowed named files, aggregate/per-file caps, redaction ordering, all unsafe paths/forms, tracked-file rejection, and unchanged Git-context behavior.
- [ ] Update `README.md` and `CHANGELOG.md` to distinguish `gitContext: full` from explicitly opted-in untracked-file content.

**Automated Verification**:

- [ ] Assert `gitContext: full` alone still sends untracked names only.
- [ ] Assert a disabled configuration sends no requested untracked body, while enabled configuration sends exactly the requested validated file body and no sibling untracked content.
- [ ] Assert secret-containing text is redacted before cap and untrusted tags cannot be escaped by crafted filenames/content.
- [ ] Run `bun test` and `bun run typecheck`.

**Manual Verification**:

- [ ] Create a new untracked source file and an untracked secret file, enable the feature, request only the source file in an Advisor review, and verify the TUI attachment indicator and Advisor context cover only that explicit file.

### Phase 5: Complete-flow verification and release documentation

Dependencies: Phases 1-4.

Verify combined behavior, preserve the established Advisor UI, and document the public contract as one coherent release.

**Tasks**:

- [ ] Add complete-flow registration tests covering ordinary advice, draft-aware advice, explicitly included untracked files, manual consultation, concurrent advice IDs, outcome reporting, preferences attachment, loop gate isolation, and Simple mode behavior.
- [ ] Confirm all newly added config fields have defaults, validation, persistence, project/global precedence tests, and settings UI navigation tests.
- [ ] Extend the existing response/error/rendering regression tests so draft/preferences attachment indicators match the established Executor `ask_advisor` and `/advisor-manual` visual surfaces.
- [ ] Update `README.md` command/tool documentation, privacy controls, configuration example, project-preferences example, and outcome-log lifecycle in user-facing terms.
- [ ] Update `CHANGELOG.md` with only the delivered behavior; do not describe intermediate designs, reverted work, or internal security iteration.
- [ ] Run the repository's full release checks: tests, typecheck, lint/format scripts available in `package.json`, package check, and diff check.

**Automated Verification**:

- [ ] Run `bun test`.
- [ ] Run `bun run typecheck`.
- [ ] Run configured lint/format and package checks from `package.json`.
- [ ] Run `git -c diff.stat=false diff --no-ext-diff --check --no-stat`.

**Manual Verification**:

- [ ] Reload the TUI and compare call, streaming, response, provider-error, and blocked-loop states against the pre-existing Advisor UI for normal, draft-aware, explicitly untracked-file-aware, and manual consultations.
- [ ] In a trusted and an untrusted test project, verify the preferences attachment behavior; then enable/disable global logging and verify only the global setting changes persistence behavior.
- [ ] Verify `gitContext: full` alone remains names-only for untracked files, then enable explicit untracked-file context and confirm only the named new source file is attached.

## Implementation Notes

- The existing `docs/agents/plans/2026-07-19-advisor-reliability.md` is still marked `draft` despite many completed checklist items. This plan must preserve its implemented Markdown-vs-gate separation, failure policy, summary locality, privacy controls, and config compatibility rather than reopening them.
- No model-weight training, reward model, GRPO loop, benchmark harness, model transfer artifact, or automatic periodic Advisor intervention is in scope. The outcome log is local measurement only.
- The original paper audit exposed a review limitation for untracked files. This plan addresses it only through explicit user opt-in and exact file selection; it does not relax the existing secure default of names-only untracked Git context.
- Before modifying lifecycle hooks, tool registration, messages, or renderers, read the installed Pi extension documentation and validate user-facing runtime-flow/UI changes in a reloaded TUI as required by `AGENTS.md`.

## References

- Paper audit: [How to Train Your Advisor: Steering Black-Box LLMs with Advisor Models](https://arxiv.org/abs/2510.02453)
- `src/tools.ts`
- `src/config.ts`
- `src/conversation.ts`
- `src/session-state.ts`
- `src/commands.ts`
- `src/ui.ts`
- `README.md`
- `CHANGELOG.md`
- `test/registration.test.ts`
- `test/config.test.ts`
- `test/conversation.test.ts`
- `test/session-state.test.ts`
- `docs/agents/plans/2026-07-19-advisor-reliability.md`
- Pi extension API: `/Users/philipbrembeck/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
