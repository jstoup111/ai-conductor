# Architecture Review: Authenticate contained Claude build_review reviewers
**Date:** 2026-09-24
**Stories reviewed:** none at first pass (pre-stories review of the technical-track explore output for #2737); re-checked against the accepted stories after conflict-check
**Mode:** lightweight (tier M): Technical Feasibility and Architectural Alignment
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

**Stack compatibility.** No new package, service, or infrastructure. The engine already reads the daemon build token (`engine/self-host/daemon-build-token.ts`) and already resolves the build-auth mode (`resolveSelfHostConfig` in `engine/resolved-config.ts`).

**Prerequisites.** None for a daemon run: an absent `build_auth` block resolves to `daemon-token`, and the daemon-level gate (adr-2026-07-22-daemon-level-missing-credential-gate, wired in `daemon-cli.ts` for every project) parks dispatch until the daemon token is readable. An interactive run without a minted token gets the named refusal pointing at `claude setup-token`, the same one-time step adr-2026-07-07 already requires.

**Integration surface.** Two module areas: the Claude provider env overlay (`execution/claude-provider.ts`), and build_review — the two containment call sites plus the infrastructure-failure lane (`engine/step-runners.ts`, `engine/build-review-domain.ts`, `engine/build-review-cli.ts`, `engine/build-review-dispositions.ts`). It reuses existing readers under `engine/self-host/` and `engine/resolved-config.ts`. One bounded context (build execution).

**Data implications.** One additive closed cause in the `BuildReviewInfrastructureFailureReason` union and its total mapping. No persisted schema migration; this cause never touches the mechanical-fault ledger field.

**Performance.** One small file read per contained Claude member. Negligible.

**Worktree isolation.** No port, database, file write, or shared mutable state is added.

## Complexity

Skipped in lightweight mode; tier M is recorded in the complexity artifact.

## Alignment

**Governing decisions reused, not duplicated.** The credential seam belongs to adr-2026-07-07-daemon-owned-build-credential, whose scope note deferred extending daemon-token auth beyond self-host. The closed-cause lane belongs to adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane. Both are amended additively (07-07 Decisions 6–8; 08-18 D2.3 and D3.2); no new ADR.

**Grant separation (adr-2026-07-07 Decision 2, #351).** Copying `.credentials.json` forks a rotating refresh grant and logs the operator out, so the filer's first hypothesis (a Codex-style file seed) is rejected on an APPROVED decision. The chosen design never reads operator OAuth; it hands the reviewer the separately minted, non-rotating daemon token. An interim draft that read the stored-login access token and refreshed it host-side was rescinded before merge once the daemon gate was found to guarantee a daemon token; the rescission is recorded in the 07-07 amendment.

**Mode consistency (adr-2026-07-07 Decision 3, adr-2026-07-22).** The reviewer uses the same resolved mode as the daemon gate and the self-host preflight, so all three agree on which credential a project runs with. No source falls back to another, so billing never changes silently.

**Containment (adr-2026-09-10-portable-build-review-policy D5).** "Keep provider client runtime/auth needs inside its private state" is satisfied: one value enters through the reviewer's private env overlay; nothing is written to or mounted into scratch. The allowlist in `execution/child-environment.ts` already admits the `CLAUDE_`/`ANTHROPIC_` prefixes; mounts and both write and host-state probes are unchanged.

**Ambient inheritance (adr-2026-08-04-live-tier-provisions-its-own-provider-home).** The engine supplies the daemon token deliberately through the overlay, overriding any inherited value, which is the re-supply that ADR permits; no unfiltered env merge is introduced.

**Fault accounting (adr-2026-08-18).** `preflight-failed` bumps the three-lap mechanical counter (D4). The operator chose the D3.1 route instead: a new deterministic closed cause, charged once, never retried, no counter bump, direct `needs-human` HALT.

**State representation.** The resolution result should be a discriminated union (available with its mode and value, or unavailable with mode, credential locator, and a closed state), not nullable strings plus flags.

**Focused local pattern basis.**
- *Role:* the deterministic-fault route. *Precedent:* `projection-oversized` in `engine/build-review-domain.ts` (`BuildReviewInfrastructureFailureReason` and its mapping table), the `projection-oversized` equality checks in `engine/build-review-cli.ts` and `engine/step-runners.ts` that gate the counter bump and direct HALT, and the closed-cause list in `engine/build-review-dispositions.ts`. *Traits to preserve:* total closed mapping; bounded `detail`; charged once; no D4 counter bump; `needs-human` HALT naming cause and remediation. *Why it applies:* D3.2 states the new cause follows D3.1. *Allowed variation:* those equality checks may become one deterministic-cause predicate, provided `projection-oversized` behaviour is unchanged.
- *Role:* reading and naming the daemon token. *Precedent:* `readDaemonBuildToken` in `engine/self-host/daemon-build-token.ts`, the shared remediation builder in `engine/self-host/build-auth-message.ts`, and the `isBuildAuthMissing` predicate in `daemon-cli.ts`. *Traits:* same mode resolution; same token-state vocabulary; one shared remediation message; the value lives in env only and is never printed.

## Wiring Surface

| New production surface | Called from in production |
|---|---|
| Contained-reviewer credential resolution (engine function) | Both build_review containment call sites in `engine/step-runners.ts` — the custom-policy member path and the built-in-peer path of a custom-policy lap — before review scratch is acquired. |
| Credential in the contained env overlay | `ClaudeProvider.buildEnv` contained branch in `execution/claude-provider.ts`, reached through the existing invoke options step-runners already passes with `reviewAccess`. |
| `reviewer-credential-unavailable` closed cause | Raised by those call sites; consumed by the infrastructure-failure lane in `engine/build-review-domain.ts`, halt routing in `engine/build-review-cli.ts` and `engine/step-runners.ts`, and `engine/build-review-dispositions.ts`; emitted on the existing `build_review_rubric_infrastructure_failure` event. |

Advisory overlap scan over these paths: no overlap detected, no open blockers.

## Domain Integrity

Skipped in lightweight mode (TDD domain review per cycle). Carried forward: the resolution result and credential-state vocabulary are closed types (see Alignment).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Daemon token value leaks into telemetry, diagnostics, or halt bodies | Security | Low | High | Diagnostics name mode, path, and state only; a test searches every event, detail, and halt body for the fixture value |
| New cause misses one of the `projection-oversized` routing seams and is retried or counted | Technical | Medium | Medium | Condition 2: one deterministic-cause predicate, with tests at every seam |
| An inherited `CLAUDE_CODE_OAUTH_TOKEN` shadows the daemon token in the reviewer env | Security | Low | Medium | The engine-owned overlay is applied after the filtered inherited env; a test sets a conflicting ambient value |
| Interactive run without a minted token now halts where it used to burn three laps | Knowledge | Medium | Low | Refusal body carries the shared remediation naming `claude setup-token` and the token path |

## ADRs Created

None. Amended: adr-2026-07-07-daemon-owned-build-credential (Decisions 6–8) and adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane (D2.3, D3.2), approved by the operator with this review.

## Conditions

1. The reviewer's credential mode comes from the same `resolveSelfHostConfig` resolution the daemon gate uses; no raw-block discriminator is introduced.
2. Every seam that special-cases `projection-oversized` also treats `reviewer-credential-unavailable` as deterministic (no retry, no counter bump, direct `needs-human` HALT), with a regression test showing `projection-oversized` is unchanged.
3. No credential value appears in any event, diagnostic `detail`, halt body, or log; the tests prove it.
4. The contained reviewer's mount set, allowlist, and two-sided probes are unchanged apart from the one overlay variable; the tests prove no credential file exists in review scratch and the operator's stored login is never read.
5. Codex contained reviewers and all non-contained Claude steps keep their current auth behaviour.
