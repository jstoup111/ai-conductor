# Architecture Review: Custom build_review rubrics run on every platform without an OS containment boundary
**Date:** 2026-09-24
**Stories reviewed:** none yet. This is a lightweight pre-stories pass (Tier M); its inputs are the
explore decision, the track scope boundary, and
`.docs/architecture/custom-build-review-rubrics-cannot-run-off-linux-o.md` with its sequence.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** No new dependency. Both read-only modes are flags of the provider CLIs
  already in use. Verified on this host on 2026-09-24:
  - `claude -p --restricted --tools "Read,Grep,Glob" --strict-mcp-config` authenticates.
  - Under those flags it returns a native `--json-schema` result.
  - It has no write tool: a requested file write was not created.
  - With Bash added and an allow rule for `git show`, the allowed command ran while `touch` was
    denied in print mode.
  - `claude --restricted --dangerously-skip-permissions` fails with "bypassPermissions not supported
    in restricted mode", so the read-only option must drop that flag.
  - `codex sandbox -P :read-only -- sh -c …` starts a process and refuses its write
    ("Read-only file system"). That is exactly the two-sided capability observation.
- **Prerequisites:** None. The feature ships before Pi (#1884), which is now `blocked_by` #2735; see
  Conditions.
- **Integration surface:** The build_review custom-lap dispatch in `step-runners.ts` covers both the
  custom-member and built-in-peer paths. Beyond it:
  - both provider adapters' argument and env builders
  - the `InvokeOptions` review field
  - the custom infrastructure-failure cause set
  - the provider admission gate's `skipReason`
  - one new `ConductorEvent` variant
  - daemon start, interactive config load, and `daemon status` rendering
  - `docs/reference/configuration.md`

  The change is mostly retirement: `build-review-containment.ts` and the review scratch-home and
  env-allowlist helpers lose their only callers.
- **Data implications:** None persisted beyond one digest record per lap under the existing
  build-review evidence root, and two additive optional fields on an existing event.
- **Performance:** The digest runs twice per custom lap over two detached worktrees, the captured
  policy material, the captured and installed policy material, and pre-existing evidence files. That costs tens of milliseconds
  to low seconds on this repository's size, against multi-minute reviewer calls. The capability
  check runs one sandboxed `true` per provider at daemon start and interactive config load, with no
  per-dispatch cost. It replaces a per-member bwrap probe, so the net per-lap cost goes down.
- **Worktree isolation:** No ports or shared state. Probe scratch lives under the per-worktree
  `.pipeline/` prefix, which is already live-boundary-excluded
  (adr-2026-08-09-worktree-local-provider-scratch). No exclusion is widened.

## Alignment

The repo-wide sweep read all 320 ADRs. Findings and dispositions:

- **Contradiction, resolved by amendment:** adr-2026-09-10-portable-build-review-policy D5 ("There
  is no prompt-only or writable fallback"; Linux bubblewrap only). It is amended with D5.1–D5.5,
  which the operator approved on 2026-09-24. D12's scoping ("New invocation-profile semantics are
  scoped to the read-only review role, not silently applied to ordinary BUILD or general custom
  steps") is kept and is the authority for the read-only option. D10's refuse-before-judging rule
  covers a policy that needs `git` on a Claude candidate.
- **Contradiction, resolved by construction:**
  adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation §3–§4 (throwaway
  provider homes for every self-host dispatch). D5.1 routes custom reviewers through the same
  prepared invocation as any step, so on self-host they keep the throwaway homes. No amendment is
  needed.
- **Closed-cause lane:** adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane is amended with
  D2.3, D3.2 and D10.2. Two causes are added. `read-only-review-unavailable` is deterministic,
  charged once and never retried, following the D3.1/D2.2 precedent. `review-input-mutated` is
  retryable under D4. Both ride the existing `build_review_rubric_infrastructure_failure` event.
- **Constraints honored:**
  - adr-2026-08-24-one-dispatch-member-on-the-provider-contract D1/D3: an additive `InvokeOptions`
    field, not a second dispatch member.
  - adr-2026-09-07-durable-prd-widening-decision-reconciliation D6/D6.1: the native-schema seam is
    reused, with no second scratch-home lifecycle.
  - adr-2026-08-13-engine-managed-build-review-rubric-branches D1.3: members still reach
    `dispatchRubricContract`.
  - adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D2: adjudication is
    untouched.
  - adr-2026-09-10-separate-custom-review-coverage-identity D1–D4: reduced-coverage identity is
    untouched.
  - adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability D1/D3: that gate (#1492)
    is still in BUILD and not on main. An unavailable read-only mode therefore uses the existing
    candidate setup-skip path (`skipReason` `setup-unavailable` with a named `setupCapability`),
    which D1 subsumes once built. It adds no new skip reason, gate, or event.
- **Composes with, no tension:**
  - adr-2026-07-13-session-fresh-verdict-artifacts, adr-2026-07-13-retry-classify-rerun-vs-route
    and adr-2026-07-22-gate-evidence-code-validity-on-redispatch. Verdict freshness and code-stamp
    reuse govern verdict artifacts. The integrity digest governs lap inputs within one lap. A
    discarded lap is `absent` under the existing classifier.
- **Deferred to Pi:** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D2–D4 (capability
  flags, boot discovery). That catalog is not built yet. This feature ships first. The Pi companion
  amendment maps the read-only review option onto a catalog capability, and may fold the capability
  check into boot discovery.
- **Event spine:** one new `ConductorEvent` variant carries the host capability result, with
  declared sinks. Per-lap occurrences use existing events with additive fields. No sidecar file,
  watcher, or log.
- **Focused local pattern basis:**
  - *Capability check.* adr-2026-08-17-structural-live-checkout-containment's two-sided probe is
    the precedent. Traits to preserve: an injected process runner; observations asserted on both
    sides (process started, write refused); fail-closed on unrecognized output; the reason carried
    verbatim. Rediscover it via `probeContainment` in `engine/self-host/live-containment.ts`. The
    ready/unusable result shape follows adr-2026-07-29-codex-readiness-probe-failure-disposition
    (the `readiness()` result in `execution/llm-provider.ts`). Allowed variation: the probed
    command is the provider's own sandbox, not bwrap, and there are two outcomes, not four.
  - *Closed causes.* The deterministic `native-schema-unsupported` handling is the precedent
    (`publishCustomOnlyBuildReview` and the mixed-lap refusal branch in `step-runners.ts`). Trait
    to preserve: refusal at once without bumping the mechanical-fault counter.

## Domain Integrity

Skipped under Lightweight Mode; the TDD domain reviewer covers it per cycle.

## Wiring Surface

- **Read-only review `InvokeOptions` field.** Set only by `dispatchInstalledBuildReviewPolicy` and
  by the built-in-peer branch of a custom-policy lap in `step-runners.ts`. Consumed in
  `ClaudeProvider` and `CodexProvider` argument and env construction. It replaces `reviewAccess`
  at every current reader.
- **Integrity digest (before/after).** Called by the custom-policy lap coordinator in
  `step-runners.ts`: once after frozen-view materialization and before fan-out, once after the
  join and before aggregation. The digest record is written under the lap's build-review evidence
  root.
- **Closed causes `read-only-review-unavailable` and `review-input-mutated`.** Added to the custom
  infrastructure-failure reason set in `build-review-artifacts.ts`. Classified by the same
  mechanical-fault routing that handles `native-schema-unsupported`. Rendered by the existing
  exhausted and deterministic halt renderers in `conductor.ts`.
- **Setup-skip for an unavailable read-only mode.** Evaluated per candidate inside
  `executeProviderCandidates` (`engine/provider-execution.ts`), only for custom-policy lap members.
  It is recorded on `provider_attempt` as the existing `setup-unavailable` skip with
  `setupCapability` naming the read-only review mode; exhausting every candidate yields
  `providerSetupExhaustion`.
- **Host read-only review capability check.** Called from `runDaemonMode` in `daemon-cli.ts`
  at start, and from interactive config loading in `index.ts` when an enabled custom member exists.
  Its daemon-scoped result is threaded into each Conductor the way `rateLimitEpisode` is.
- **New capability `ConductorEvent` variant.** Emitted through `ConductorEventEmitter` by the
  check, and declared in the event-sink registry. It is rendered by `daemon-cli.ts`'s log renderer
  and by `daemon status` (`daemon-observe-cli.ts`) from the persisted spine.
- **Retired:** `engine/build-review-containment.ts`, and the review scratch-home, copied-login and
  env-allowlist helpers. They lose every production caller; deletion follows the `code-removal`
  skill. No directory is deleted.
- **Docs:** `docs/reference/configuration.md` `build_review.custom_rubrics` platform text.

Early overlap scan (advisory) over these paths: "No overlap detected; no open blockers." The Pi
spec (#1884) is spec-only on main, so the scan cannot see it. It is handled under Conditions.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A custom reviewer reads operator host state or sibling evidence | Security | Low | Medium | Accepted by operator (D5.4); Claude restricted to Read/Grep/Glob with no MCP; Codex OS read-only sandbox; documented in configuration reference |
| A write reaches a protected input despite read-only mode (e.g. provider bug, outside process) | Data | Low | High | D5.3 digest discards the whole lap; retryable closed cause bounded by D4; halt names changed inputs |
| Claude CLI changes restricted-mode semantics (e.g. re-adds a write tool) | Integration | Low | High | Explicit `--tools` allowlist, not reliance on `--restricted` defaults; capability check verifies the CLI accepts the flags; digest backstop |
| macOS read-only modes unverified on real hardware (no macOS CI) | Knowledge | Medium | Medium | Claude's restricted flags are platform-independent CLI behavior (inferred 90%); Codex read-only uses Seatbelt per its docs (verified in docs); the capability check reports unavailability on the host rather than halting after three faults |
| Codex read-only sandbox fails under Ubuntu's AppArmor userns restriction | Integration | Low | Medium | It is single-level bubblewrap, which the issue shows succeeds (inferred 85%); if not, capability check skips Codex and Claude remains a candidate |
| Pi feature rebases onto a retired module | Integration | High | High | #1884 `blocked_by` #2735 (set 2026-09-24); companion amendment to Pi's plan Task 5 lands with this spec |
| Discarding the whole lap on one mutation wastes peer reviews | Performance | Low | Low | Mutations are expected to be rare; attribution is impossible with a shared concurrent view |

## ADRs Created

None. Amendments, APPROVED by James Stoup on 2026-09-24:
- adr-2026-09-10-portable-build-review-policy: D5.1–D5.5
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane: D2.3, D3.2, D10.2

## Conditions

1. A companion main-based PR amends the Pi spec (`pi-as-a-build-provider` plan Task 5, plus any
   coherence rows and ADR text that quote it). It drops `build-review-containment.ts` from Pi's
   scope and narrows the read-only review option by provider capability instead. It merges together
   with this spec PR. #1884 stays `blocked_by` #2735 until this feature ships.
2. Stories must carry the macOS outcome as a criterion the diff can prove: the capability check's
   platform-independent logic plus the Claude restricted-flag mapping. Real-macOS behavior is
   recorded as unverified-at-ship, not claimed.
3. Built-in-only laps must be proven byte-identical in invocation (flags and env) before and after.
4. `record-reduced-coverage` must accept `read-only-review-unavailable` without an exhausted
   allowance, as it already does for `projection-oversized`. Otherwise the at-once halt has no
   operator lever (conflict-check finding).
