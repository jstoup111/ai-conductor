# Architecture Review: Semantic Attribution Verification (two-lane evidence gate, #520)

**Date:** 2026-07-11
**Mode:** Full pre-stories review (Tier L, technical track)
**Input reviewed:** explore output + operator-approved approach and diagrams
(`.docs/architecture/evidence-gate-validates-provenance-proxies-not-whe.md`);
stories/plan do not exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** pure TypeScript engine work on existing seams — gate predicate
  (`artifacts.ts` build), derivation (`autoheal.ts`), sidecar (`task-evidence.ts`),
  fresh-session dispatch (`step-runners.ts` `runBuildReview` pattern,
  `invokeWithLadder`), config (`resolved-config.ts`). No new packages, services, or
  infra. Verified against main @ `7138f0f4`.
- **Prerequisites:** none hard. #245 per-task test mapping (unmerged) is explicitly NOT
  a dependency — test evidence is verifier-reported until it lands (residual risk,
  recorded in the lane ADR). #500/#469 types are NOT imported (verdict ADR).
- **Integration surface:** build gate evaluation, retry-hint seeding, daemon status
  (agreement rate), halt-monitor feed (divergence event), CLI dispatcher, config
  loader, model table. Wide but all first-party; no cross-repo or external-API surface.
- **Data:** two files gain additive content — `task-evidence.json` (new optional stamp
  fields + one new `form` value; verified no reader switches on `form`) and new
  `.pipeline/attribution-verdict.json` + `.daemon/attribution-accuracy.jsonl`. No
  migrations, no destructive rewrites; existing stamps immutable.
- **Performance:** opus dispatch per NEW (HEAD, residue) state on red tries — memoized,
  so a no-progress retry costs zero; spot-audit adds ~sample_pct% of one dispatch per
  green build. Both bounded and config-disableable.
- **Worktree isolation:** all writes are per-feature (`.pipeline/` sidecars in the
  feature worktree; `.daemon/` ledger in the main repo, append-only JSONL — concurrent
  appends are line-atomic at these sizes). CLI refuses concurrent judging of an
  active build.

## Complexity

L (recorded at `.docs/complexity/evidence-gate-validates-provenance-proxies-not-whe.md`):
net-new engine subsystem + measurement sub-feature + CLI + config + model-table +
replay-style acceptance corpus. Split was considered and rejected: the no-whitewash
validation and the measurement lane are load-bearing counterweights to the judged lane —
shipping the judge without the audit would ship exactly the unmeasured trust the issue
condemns. The CLI entry rides the same lane code and is thin.

## Alignment

Checked against every APPROVED ADR in `.docs/decisions/` touching this seam:

| Invariant (source) | Status |
|---|---|
| Evidence gate sole completion authority (adr-2026-07-09-deterministic-evidence-attribution-enforcement D3) | Preserved — verifier output becomes ordinary sidecar stamps written by the engine; gate re-derives as sole authority |
| Abstain-never-misstamp (#433, runbook refusal rules) | Preserved and mechanized — schema coercion + git-level citation validation refuse every unprovable verdict |
| No second completion currency (adr-2026-07-10-inline-work-attribution-enforcement) | Preserved — no new currency; one new `form` value inside the existing currency |
| Fail-open provisioning (#433/#494/#509) | Untouched — lane adds zero provisioning-time machinery; inert without cutover |
| Bounded kickback / retry budget (build_review ADR D6) | Preserved — lane runs inside existing tries; memoization prevents unbounded judging; auto-park threshold semantics intact (judged stamps = progress) |
| build_review strictly upstream of #469 validation group (parallel-validation conflict doc) | Preserved — lane is upstream of build_review (inside the build gate); spot-audit is post-green, non-blocking |
| Deterministic-first (CLAUDE.md) | Honored — mechanical lane stays first and primary; LLM confined to residue judgement (the operator's manual role today); measurement quantifies the judge rather than trusting it |
| Line-1 dispatch-prompt contract (adr-2026-07-10-session-hook-task-stamping) | Verifier dispatches are non-build sessions (`Task: none` class), consistent with build_review's existing exemption |

**Pattern consistency:** engine-embedded judge follows `build-review-prompt.ts` +
`runBuildReview` exactly; config cutover follows `attribution_enforcement_cutover`;
ledger follows existing JSONL signal files. No novel pattern without an ADR.

## Domain Integrity

- Verdict union is a closed discriminator (`satisfied`/`unsatisfied`/`no-verdict`) with
  schema-level coercion — invalid states (satisfied-without-citations,
  satisfied-without-test-evidence) are unrepresentable after parse.
- Stamp `form` remains an open string by existing design; new value is additive.
  (Tightening `form` to a union is noted as optional hardening, not required here.)
- Task ids stay strings end-to-end per the H9 grammar (`TASK_ID_PATTERN`); the #501
  numeric-id hook bug is out of scope and unaffected by this design.
- No `else`-default on the verdict discriminator: unknown verdict strings coerce to
  `no-verdict` explicitly (the safe direction).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Judge whitewashes an unimplemented task | Integrity | Low | High | Dual-layer refusal: schema coercion + engine git/path/test validation; genuinely absent work has no satisfying SHA to cite; spot-audit measures the judge itself |
| Judge abstains on satisfiable residue (variance) | Technical | Medium | Medium | Existing ladder + manual recipe remain; memoization means a later try with new commits re-judges; accuracy ledger surfaces chronic abstention |
| Verifier-reported test evidence gamed/stale until #245 | Integrity | Medium | Medium | Recorded residual risk; engine re-execution lands with #245; citations + path overlap still mechanically verified |
| Opus cost inflation on thrashing builds | Performance | Low | Medium | (HEAD, residue) memoization; zero-work-product tries skip the lane; cutover/config off-switch |
| CLI judge races the daemon on the same feature | Data | Low | Medium | Active-build refusal in the CLI; single-daemon-per-repo operating assumption |
| #500 merges with a different union shape | Integration | Medium | Low | Local types + thin adapter (verdict ADR Option A) |
| Divergence signal ignored (measurement without consumption) | Knowledge | Medium | Medium | Daemon-status surface + halt-monitor feed wiring are explicit follow-ups in the spot-audit ADR |

## ADRs Created (all DRAFT, pending operator approval)

1. `adr-2026-07-11-semantic-attribution-verification-lane` — the two-lane core: residue
   trigger, memoization, engine-embedded verifier, no-whitewash validation, stamping,
   split attribution, retry-hint feedback, non-goals.
2. `adr-2026-07-11-attribution-verdict-interface` — verdict union (local, BranchOutcome-
   convergent), fail-closed parsing/coercion, stamp form `semantic-verified` + additive
   audit fields.
3. `adr-2026-07-11-attribution-spot-audit-measurement` — deterministic sampling,
   post-green non-blocking dispatch, accuracy ledger, divergence-as-signal (never a
   halt, never auto-revocation).
4. `adr-2026-07-11-evidence-judge-cli-and-cutover` — `conduct-ts evidence judge` (+
   `--dry-run`), `attribution_judge_cutover` / `attribution_audit_sample_pct` config
   keys, `attribution_verify` model-table row, migration-block obligation.

## Conditions

1. **All four ADRs must be operator-APPROVED before `/stories`** (hard gate, §7b).
2. The implementation PR MUST carry: CHANGELOG `## Migration` block (CLI + config keys),
   model-table regeneration in the same diff, README + `src/conductor/README.md` updates
   (docs-track-features rule).
3. Acceptance corpus condition: stories must include replay of the six escape shapes
   (plus #519's frozen-stamp variant) and the negative path (unimplemented task refused
   in both invokers) — the issue's outcome (f) is the acceptance bar.
4. Until #245 merges, every `semantic-verified` stamp's test evidence is
   verifier-reported; the follow-up is tracked in the lane ADR and must be filed as an
   intake issue when this feature ships.
