# Architecture Review: Runtime values remain literal data

**Date:** 2026-09-06
**Mode:** Lightweight (Medium); technical feasibility and architectural alignment
**Input:** Operator-approved technical track, scope, argument-passing approach, and component diagram. No stories or plan exist yet.
**Verdict:** APPROVED

## Feasibility

The existing Python and Node runtimes support the chosen local pattern: fixed source reads quoted positional arguments. No dependency, schema, configuration key, external service, or migration of stored data is required. Python removal remains #2266. The implementation must preserve caller-specific input grammars rather than promise unsupported arbitrary Git trailer encodings.

The current installer helpers merge permissions and hooks into settings JSON; passing settings/temp/hook-directory paths as data repairs their interpolation without changing merge semantics. Both helpers must return failure on interpreter/read/parse/write errors, with contextual diagnostics and no success message. The install caller already treats those failures as warning-and-continue; preserve that policy. configure_hooks currently prints an error but does not return failure explicitly, so this error-result propagation is part of the desired outcome.

The generated commit-msg hook performs task membership lookup only when a trailer and status file are present. Keep numeric/string ID normalization, existing exemptions, missing-trailer behavior, missing-file behavior, and task-N rejection. Pass both status path and trailer via quoted arguments to fixed JavaScript. A valid negative lookup retains its rejection; an interpreter/read/parse failure rejects with a distinct contextual diagnostic instead of pretending the ID is absent. This does not introduce a new grammar or evidence gate.

The session-start summary uses a fixed relative state path today. Convert that source expansion as preventive cleanup. Missing state remains quiet; malformed/unreadable state or missing interpreter produces a contextual stderr warning and continues the hook. Preserve the summary's counts and remaining context output. Do not add a new path override solely to manufacture a test.

## Alignment

The approved adr-2026-07-21-demote-task-stamping-to-telemetry retires evidence/presence gating while retaining trailer grammar validation. This repair does not reintroduce evidence requirements. adr-2026-08-09-non-blocking-plan-scope-containment keeps scope-check advisory; its current launcher, exit handling, and chaining remain intact.

Local pattern basis: session-hook-assets.ts PRE_DISPATCH_HOOK uses fixed single-quoted JavaScript and reads a separately passed ID from process.argv. Preserve source/data separation and shell argument quoting; its telemetry locking and state-update behavior are not relevant to this repair. bin/migrate also uses quoted Python heredocs with argv. BUILD should rediscover these patterns by symbol, not assume fixed line numbers.

The recurrence mechanism is a repository validation check, not a service or runtime integration. It examines the shipped shell surface (bin entrypoints and shell libraries, hooks) and actual rendered strings from git-hook-assets.ts and session-hook-assets.ts. It must automatically enumerate files within that declared scope and verify the generated-asset inventory, failing on an empty/unreadable inventory or rendering failure. Test fixtures and documentation examples are not shipped inputs and are not subject to the production scan.

Recognize direct Python command-source (-c and stdin/heredoc) and Node -e/--eval forms, including multiline source words and heredocs. Detect shell expansions inside interpreter source, while permitting constant source, quoted heredocs, literal interpreter dollar characters, and separately passed argv/stdin/environment data. Diagnostics identify source asset and line. Exercise unsafe parameter, command-substitution, and backtick forms with fixture-based classification tests; do not execute candidate scripts. A raw grep for dollar signs is insufficient because quoting determines expansion. Scope is direct interpreter-source construction, not arbitrary shell alias/eval dataflow analysis or a claim that every possible code-injection mechanism is solved.

## Wiring Surface

- bin/install configure_permissions and configure_hooks remain called from install(); fixed interpreter code reads their arguments.
- git-hook-assets.ts buildCommitMsgHook remains exported as COMMIT_MSG_HOOK and installed by worktree-prepare.ts during preparation. Exercise the rendered hook, not a duplicated JavaScript fragment, in integration coverage.
- hooks/claude/session-start-context.sh remains the installed Claude session-start entrypoint; no Codex hook equivalent is invented.
- A repository-only interpreter-source checker under src/conductor/scripts/ is invoked from test/test_harness_integrity.sh through a small shell wrapper under test/. Its checker module receives source texts for focused unit fixtures and a production inventory runner reads shipped scripts plus generated assets. Existing interpreter runtimes suffice; no new parser package or external service is a prerequisite.
- Relevant canonical documentation changes belong with implementation: settings/hooks behavior and repository validation coverage. README, HARNESS behavioral rules, VERSION, and CHANGELOG are not changed by this spec.

## Verification design

Use bounded local integration tests at each changed boundary: the rendered commit hook in a temporary Git repository; installer configuration functions against temporary settings files with no installation/package/network flow; the actual session-start script against temporary state. Retain numeric/string ID compatibility and preservation/idempotency of settings merges. Check literal quotes, backslashes, whitespace and interpreter-looking text within the actual input grammar. Harmless sentinel probes prove no unintended execution; failure cases assert diagnostics, exit policy, and no success claim.

The recurrence checker owns classification fixtures and an entrypoint proof that a newly introduced unsafe shipped script or generated hook fails repository validation. Existing safe forms must pass. Do not test natural-language guidance by matching wording. No tests call real third-party services. Story criteria will assign each behavior to the lowest sufficient layer; no full conductor loop is justified.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Checker confuses shell quoting with interpreter literals | Technical | Medium | Medium | Quote-aware classification with positive/negative multiline fixtures; bounded documented forms |
| Generated assets escape file-only scanning | Integration | Medium | Medium | Inspect rendered exports and verify inventory rather than grep TypeScript string literals |
| Error cleanup changes advisory hooks into blockers | Integration | Medium | Medium | Assert caller-specific exit behavior and existing exemptions |
| Settings merge tests accidentally run installation | Data | Low | Medium | Invoke existing functions with temporary paths, fake unrelated boundaries, never run setup |

## Scope and overlap

Runtime repair: consumer-facing. Repository recurrence validation: repo-local. Catalog: n/a. Provider: agnostic mechanism with Claude-owned hook paths explicitly scoped. No new skill or registration changes.

The advisory overlap scan completed on bin/install, session-start-context.sh, git-hook-assets.ts, and test_harness_integrity.sh. It reported bin/install against numerous local/remote spec refs, including commit-msg-hook-rejects-valid-task-ids-when-task-s and pipeline-run-state-lives-inside-the-worktree-cwd-r. These ref hits do not establish currently active conflicting implementation. The former spec concerns numeric/string task-ID compatibility, which this design preserves. Re-resolve current code and branch overlap before BUILD; do not copy obsolete instructions from historical plans. The scan warns that renames/name-only diffs may be missed.

## ADRs Created

None. This changes argument transport and error reporting inside existing components and adds a repository check; it establishes no new system boundary, service decomposition, persistence model, integration pattern, or foundational technology. Existing governing ADRs above are reused.

## Verify-Claims Ledger

- Verified: commit hook inserts status path and trailer into JavaScript; a probe of its current emitted lookup accepted existing 1 and rejected existing O'Brien. Source: git-hook-assets.ts buildCommitMsgHook.
- Verified: installer functions interpolate settings/temp/hook-directory paths into unquoted Python heredocs. configure_permissions returns 1 on write failure; configure_hooks lacks the corresponding explicit failure return. Source: bin/install named functions and install() callers.
- Verified: session-start source expansion uses a fixed literal path; it is preventive cleanup, not a current arbitrary-input reproduction. Source: session-start-context.sh PIPELINE_STATE assignment and summary.
- Verified: the established generated PRE hook separates the task argument from source. Source: session-hook-assets.ts PRE_DISPATCH_HOOK.
- Verified: bin/conduct was removed in 7035ebbbc; its original #1478 state paths are excluded.
- Operator-confirmed: Medium technical scope, fixed source with quoted arguments, recurrence prevention, and Python removal deferred to #2266; architecture diagram approved in chat.
- No unconfirmed load-bearing assumptions remain. Verdict: CLEAR.
