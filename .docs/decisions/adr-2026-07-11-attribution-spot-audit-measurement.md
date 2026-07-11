# ADR: Spot-audit measurement of fast-lane attribution accuracy

**Date:** 2026-07-11
**Status:** APPROVED (operator, 2026-07-11)
**Deciders:** James Stoup (operator), engineer session for intake #520

## Context

Issue #520 outcome (b): the mechanical fast lane's accuracy must be continuously
MEASURED, not assumed — "we learn its error modes one production halt at a time, and
there is no mechanism that would detect a false-POSITIVE (work wrongly attributed and
accepted) at all." The same verifier that judges gate residue
(adr-2026-07-11-semantic-attribution-verification-lane) can re-verify a sample of
mechanically-attributed tasks and compare verdicts.

Constraints: measurement must never block or destabilize a build (signal, not halt);
sampling must be reproducible for audit; the sampler should be positioned so it can
later run as an ordinary #469 validation-group member.

## Options Considered

### Option A: Post-gate-green, non-blocking sample; JSONL ledger; divergence = event + status surface
- **Pros:** zero impact on gate latency or verdict; deterministic hash sampling is
  replayable; ledger greppable and append-only; daemon status can surface agreement rate.
- **Cons:** measurement lags the build (acceptable — it is telemetry, not a gate).

### Option B: Inline audit during the gate evaluation (sample judged synchronously with every green)
- **Pros:** immediate detection.
- **Cons:** adds opus latency+cost to every green build; a divergence mid-gate invites
  exactly the "future production halt" the issue forbids; couples measurement to gating.

### Option C: Offline batch audit (cron over historical builds)
- **Pros:** cheapest per-build.
- **Cons:** new scheduler surface; drifts from the build context (worktrees pruned,
  branches rebased — citations may no longer resolve); James's environment already
  rations background polling.

## Decision

**Option A.**

1. **Sampling:** when the build gate goes green for a feature, the engine selects each
   mechanically-stamped task (`form` ∈ `trailer` | `evidence:satisfied-by`) for audit iff
   `sha1(featureSlug + ':' + taskId) mod 100 < attribution_audit_sample_pct`.
   Deterministic — re-running the selection reproduces the sample; no RNG in the engine.
   Default `attribution_audit_sample_pct: 10`, configured in committed
   `.ai-conductor/config.yml` beside the cutover flag (companion CLI-and-cutover ADR);
   `0` disables the audit lane entirely.
2. **Dispatch:** the sampled set goes through the SAME verifier (same prompt, same
   input assembly, same fail-closed parsing) in one fresh session, fire-and-forget after
   the gate result is already recorded — a verifier failure or timeout loses one sample,
   never a build. Runs before the worktree is pruned so diffs/tests resolve.
3. **Ledger:** `.daemon/attribution-accuracy.jsonl` (repo-local, append-only, one JSON
   object per audited task): `{ts, feature, taskId, fastLaneForm, fastLaneSha,
   auditVerdict, agree: boolean, citations?, reason?}`. The daemon status surface reports
   the rolling agreement rate.
4. **Divergence:** `agree: false` (the judge finds a mechanically-completed task's diff
   does NOT satisfy it — a false positive, #520 outcome (c)) appends the ledger record
   AND emits an `attribution_divergence` engine event. It never revokes the stamp, never
   reopens the build, never halts — an observable flag for the operator/halt-monitor to
   triage. Repeated divergence is the signal to tighten the mechanical lane; acting on
   it stays a human decision.
5. **#469 composition:** the audit dispatch is a self-contained callable with a
   three-way outcome (mirrors the verdict union). When #500's validation group merges,
   it becomes an ordinary group member via the same thin adapter as the verifier —
   nothing here assumes serial builds.

## Consequences

### Positive
- Fast-lane accuracy becomes a measured quantity with a home and a unit (agreement rate).
- False positives — previously undetectable by construction — get an observable flag.
- The measurement lane doubles as a live canary for verifier quality (a sudden agreement
  drop implicates the judge as much as the lane).

### Negative
- ~N% of green builds pay one extra opus dispatch (bounded by the sample rate; default
  10%).
- The ledger is repo-local: cross-repo aggregate accuracy requires reading each repo's
  file (accepted at current scale — one operator, few repos).
- Verifier-vs-mechanical disagreement is not ground truth; a divergence record is a
  triage prompt, not a verdict (the honest framing of any judge-vs-proxy comparison).

### Follow-up Actions
- [ ] Implement deterministic sampler + post-green dispatch + ledger writer.
- [ ] Surface rolling agreement rate in `conduct-ts daemon status`.
- [ ] Wire `attribution_divergence` into the halt-monitor's triage feed (non-halting).
