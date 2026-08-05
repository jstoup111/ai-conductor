# Architecture Review: Release-Time Smoke and Eval Gate

**Date:** 2026-08-04
**Feature:** no-release-time-smoke-or-eval-gate-releases-cut-wi (jstoup111/ai-conductor#1259)
**Tier:** M (lightweight mode — Sections 2 and 4 only)
**Track:** technical
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | **Clear.** No new dependency. A second Vitest config is an established pattern in this repo (`vitest.live-smoke.config.ts`). The classify split is an extraction from existing TypeScript. |
| Prerequisites | **One, blocking — see Conditions.** `CLAUDE_CODE_OAUTH_TOKEN` must be provisioned as an Actions secret before merge. Verified 2026-08-04: only `RELEASE_PR_APP_ID` and `RELEASE_PR_APP_PRIVATE_KEY` exist. |
| Integration surface | **Three boundaries, all existing.** `release.yml` (job restructure), `release-publisher-action.ts` (new export), the nine smoke files (capability declaration). Reuses `live-daemon-e2e.yml` via `workflow_call` rather than adding a fourth. |
| Data implications | **None.** No schema, no migration, no persisted state. The publisher deliberately keeps no local publication ledger. |
| Performance risk | **Bounded and deliberate.** The live leg is the cost centre; `DAEMON_E2E_LIVE_TOKEN_CAP` (default 100000) already caps it, and the classify-first ordering bounds frequency to one run per release. |
| Worktree isolation | **Not applicable.** CI-only change; no ports, services, or shared local state. The smoke tier inherits the suite's existing tmpdir and leak guards via the shared `setupFiles`/`globalSetup`. |

**Verified claims** (basis: read at the reviewed HEAD)

- `runReleasePublisherAction` performs no mutation before line 94 — every prior line is a read or
  a `return`. The classify extraction is therefore behavior-preserving. *Verified, 95%.*
- The publisher is idempotent across re-runs: skip-if-tag-exists (80-86, 94), skip-if-release-exists
  (89-92, 97). Recovery-by-re-run is sound. *Verified, 95%.*
- `test/structural/test-execution-policy.test.ts:79-82` fails if either exclusion glob leaves
  `vitest.config.ts`. *Verified, 99%.*
- `live-daemon-e2e.yml` already exposes `workflow_call` with `require_credentials`, and
  adr-2026-08-02 reserves gate mode for exactly this caller. *Verified, 99%.*
- `bin/setup:53-54` runs `npm install`, so `publish-interrupted.smoke.test.ts` is not hermetic.
  *Verified, 90%* — the script prefers copying `node_modules` from the primary checkout, so the
  install may not always execute; the test still cannot be classified hermetic.

**Assumptions surfaced**

- **A-1 (inferred, 85%):** re-running a push-triggered workflow run preserves `github.sha`, so
  recovery needs no new trigger. *Impact if wrong:* recovery requires adding `workflow_dispatch`
  with a commit input to `release.yml` — a small additive change, not a redesign. Confirm on the
  first blocked release.
- **A-2 (inferred, 80%):** calling `live-daemon-e2e.yml` from `release.yml` requires
  `secrets: inherit`, since the called workflow references `secrets.CLAUDE_CODE_OAUTH_TOKEN`
  directly rather than declaring a `secrets:` input. *Impact if wrong:* the credential arrives
  empty and gate mode fails the release with a missing-secret error — loud and self-describing,
  not silent. Must be covered by a plan task.
- **A-3 (unverified, 60%):** the three currently-ungated smoke files pass today. Nothing has run
  them in CI, so their state is unknown. *Impact if wrong:* the fail-closed gate blocks the first
  release. Mitigated by the Conditions below, which require running the tier before wiring it.

## Alignment

**Against `CLAUDE.md` design principles**

- *Deterministic where possible; LLM only where necessary* — **strongly satisfied.** The
  cost-control mechanism is a pure classification function over GitHub state, not prompt
  discipline or operator vigilance. The decision "should we spend money here?" is answered by
  machinery at the moment of the decision.
- *Third-party calls are smoke-only in tests* — **preserved.** `vitest.config.ts` keeps both
  exclusion globs; the new config is additive. `npm test` retains its isolation guarantee.
- *Documentation upkeep* — `docs/contributing/testing.md` (the per-file gate table and its "there
  is no `npm run smoke`" statement) and `docs/contributing/releases.md` (the release mechanism)
  both go stale on merge and must be updated in the same PR.

**Against existing ADRs**

- **adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate** — **consumed as designed, no
  conflict.** That ADR explicitly scopes `release.yml` wiring out to #1259 and states its purpose
  is to guarantee "the seam exists so that wiring is a caller change, not a rewrite." This feature
  is that caller change. Its gate-mode semantics (missing credential is a failure) are adopted
  verbatim rather than reinvented.
- **adr-2026-08-01-bot-owned-release-pr** — **preserved.** Publication authority still derives
  solely from live GitHub evidence at publication time; classify is explicitly denied authority
  and the publish job re-derives every condition.

**Pattern consistency**

- The second-config pattern follows `vitest.live-smoke.config.ts` exactly, including the
  non-obvious `exclude: []`.
- The classify/act split mirrors `2026-07-22-build-auth-token-check-and-classify`, an established
  shape in this codebase for separating a cheap decision from an expensive or mutating action.
- **New pattern introduced:** capability declaration on tests. Justified by
  adr-2026-08-04-smoke-capability-declaration-and-single-entry-point.

**State management.** The capability is a closed enum, not a set of independent booleans, so
"credentialed but also hermetic" is unrepresentable. Advisory-vs-gate is a single mode with two
values rather than a per-file flag, so a file cannot disagree with the run about its own strictness.

**Security boundaries.** No new authority surface. The classify output cannot cause a tag —
worst case it wastes a smoke run or yields a `rejected` publish. The credential is consumed only
inside the already-reviewed live workflow.

## Wiring Surface

| New/changed surface | Where it is called from in production |
|---|---|
| `classifyReleasePublication` (new export, `src/engine/release-publisher-action.ts`) | Re-exported from `src/conductor/src/index.ts`; imported by `release.yml`'s **classify** job via `actions/github-script` loading `src/conductor/dist/index.js` — the identical mechanism the workflow already uses for `runReleasePublisherAction`. |
| `runReleasePublisherAction` (changed — consumes the extracted prefix) | Unchanged caller: `release.yml`'s **publish** job. |
| `npm run smoke` (new `package.json` script) | `release.yml`'s **smoke** job; and by maintainers locally, as the documented single command. |
| `vitest.smoke.config.ts` (new) | Consumed by the `smoke` script; not referenced by `npm test`. |
| Smoke capability helper (new module under `test/`) | Imported by all nine smoke files; its ledger is emitted by the `smoke` run and surfaced in the job summary. |
| `live-daemon-e2e.yml` gate mode (existing, newly reached) | `release.yml`'s smoke job via `uses: ./.github/workflows/live-daemon-e2e.yml` with `require_credentials: true` and `secrets: inherit`. |
| Capability/entry-point documentation | `docs/contributing/testing.md`; release-gate behavior in `docs/contributing/releases.md`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` unprovisioned at merge → first release blocks | Integration | **High** | **High** | Condition C-1: provision before merge. Gate failure names the exact missing secret. |
| Previously-ungated smoke files fail once actually run | Technical | Medium | **High** | Condition C-2: run the full tier and fix or quarantine before wiring the gate. |
| Reusable-workflow call omits `secrets: inherit` | Integration | Medium | Medium | A-2; explicit plan task. Failure mode is a loud missing-credential error, not a silent pass. |
| Live leg flakes and blocks an otherwise good release | Technical | Medium | Medium | Re-run on the same SHA is safe and cheap to reason about (publisher is idempotent). Token cap bounds a runaway run. |
| Classify and publish disagree (candidate changes between jobs) | Technical | Low | Low | Publish re-derives authority; disagreement yields `rejected`, never a bad tag. |
| Cost regression via a future unconditional smoke step | Knowledge | Low | Medium | ADR records the classify-before-spend invariant as the reason for the job ordering. |

## ADRs Created

- `adr-2026-08-04-classify-before-spend-release-smoke-gate.md` — **APPROVED**
  (Infrastructure / CI-CD pipeline structural change.) Settles OQ-2, OQ-3, OQ-4.
- `adr-2026-08-04-smoke-capability-declaration-and-single-entry-point.md` — **APPROVED**
  (Cross-cutting concern / test-execution policy.) Settles OQ-1.

No existing ADR is superseded.

## Conditions

**C-1 — Provision `CLAUDE_CODE_OAUTH_TOKEN` before this feature merges.** Gate mode fails on a
missing credential by design, so merging first blocks the next release. This is a prerequisite,
not a follow-up.

**C-2 — Run the full tier once and resolve the result before wiring the gate.** Three files
(`finish-record`, `publish-interrupted`, `surgical-finish-retry`) have never run in CI; their
current state is unverified (A-3). Any failure must be fixed or explicitly quarantined, because
the gate is fail-closed and will otherwise block the first release for a pre-existing defect.

**C-3 — The gate's failure output must name the failing smoke case, its unmet capability if any,
and its evidence path.** Attributability is a stated requirement of the issue, and a release
blocked by an unattributable failure is an operational trap.

**C-4 — Update `docs/contributing/testing.md` and `docs/contributing/releases.md` in the same
PR.** The former documents the per-file gates and asserts no `npm run smoke` exists; the latter
documents the release mechanism this changes.
