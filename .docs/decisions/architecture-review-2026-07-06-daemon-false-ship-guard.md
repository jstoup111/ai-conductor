# Architecture Review: daemon false-ship guard (#337)
**Date:** 2026-07-06
**Mode:** lightweight (Tier M) — feasibility + alignment
**Input reviewed:** issue ai-conductor#337, approved approach
(.memory/decisions/2026-07-06-daemon-false-ship-guard-approach.md), approved diagrams
(.docs/architecture/daemon-false-ship-guard.md). Technical track — no PRD; stories do not
exist yet.
**Verdict:** APPROVED

## Feasibility

All anchors verified by direct code read this session (not agent hearsay):

- **Gate extension** (`artifacts.ts` finish predicate, ~:737-796): `CompletionContext`
  already carries an injectable evidence reader added by #367 (`getHeadSha`,
  `artifacts.ts:245-263`) — adding a push-evidence injectable + a daemon flag follows a
  proven seam. Conductor builds the ctx in `completionCtx(state)` and knows daemon mode.
- **Push evidence without network:** a successful `git push` advances the local
  remote-tracking ref, so `git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>`
  is deterministic and offline. No fail-open network hole (contrast: the halt-title gh
  check is deliberately fail-open).
- **Daemon guard** (`daemon-runner.ts:173-225`): `outcome.finishChoice`/`outcome.prUrl` are
  already parsed (`daemon-deps.ts:229-245`, #204/#205) — the guard consults existing data.
  The HALT route mirrors the existing `outcome.halted` branch (keep worktree, report
  halted); `escalateBuildFailure` (`build-failure-escalation.ts:73-`) is dependency-injected,
  cwd-based, best-effort/non-throwing — callable from the daemon with the worktree as cwd.
- **Skill gate** (`skills/finish/SKILL.md` §5 Option 2): mirrors the existing §1b STOP-gate
  pattern (:114-160). Doc-only change; validated by test_harness_integrity.sh.

No new packages, services, schema, or infra. No worktree-isolation impact (evidence check
reads the feature worktree's own refs).

## Alignment

- **Evidence-based gating precedent:** #367 whitewash guard and the acceptance-specs RED
  evidence gate — this change is the same shape (gate must see proof of work, fail-closed
  where deterministic, fail-open only where evidence is genuinely unavailable).
- **Convention over precedent:** `readWorktreeOutcome`'s comment documents that DONE
  converges for every finish choice; that documented behavior is what #337 shows to be the
  defect. The ADR supersedes that comment's assumption for daemon mode; no APPROVED ADR
  conflicts (adr-2026-07-03-committed-shipped-record-dispatch-dedup is compatible — dedup
  still degrades to the ledger marker, which now can't be written falsely).
- **State management:** no new boolean flags; the guard uses the existing
  `finishChoice` enum-ish marker + prUrl presence. Invalid state
  (`shipped` + `prUrl:null`) becomes unrepresentable at both write sites
  (`markProcessed`, `repairProcessed`).
- **Escalation reuse:** HALT surfacing reuses `escalateBuildFailure` — no new pattern, no
  new gh entry point (keeps the #290/#331 gh-failure blast radius unchanged).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A daemon flow legitimately relying on keep/merge-local convergence gets halted | Technical | Low | Medium | Auto-prompt only emits `pr` or fallback `keep` (verified step-runners.ts:656-661); HALT reason names the choice; operator clears via HALT.cleared |
| Push done under a nonstandard remote name → tracking-ref evidence false-negative | Technical | Low | Medium | Derive remote from branch upstream config, fall back to `origin`; gate reason says exactly what evidence is missing |
| Escalation push fails (FR-7 swallow) → HALT with no remediation PR | Integration | Medium | Low | HALT marker + kept worktree still protect the work; monitor surfaces HALTs |
| Legacy callers without the new ctx injectable silently skip the evidence check | Technical | Low | Medium | Same fail-open contract as #367 getHeadSha; daemon-cli threads the injectable — covered by a negative-path story |

No High-impact risks.

## ADRs Created

- `adr-2026-07-06-daemon-false-ship-guard.md` — DRAFT, presented for operator approval in
  this engineer session (interactive equivalent of the review_artifacts gate; approval
  recorded by flipping Status to APPROVED before land).

## Conditions

None. Stories must include negative paths per the negative-path-specs rule: null prUrl,
stale reused PR URL with unmoved branch, keep-fallback in daemon mode, missing injectable,
escalation push failure.
