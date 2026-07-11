# ADR: `conduct-ts evidence judge` CLI entry, cutover flag, and model-table entry

**Date:** 2026-07-11
**Status:** APPROVED (operator, 2026-07-11)
**Deciders:** James Stoup (operator), engineer session for intake #520

## Context

Three operational surfaces of the semantic verification lane
(adr-2026-07-11-semantic-attribution-verification-lane) need explicit decisions:

1. **Operator recovery** — #467 documents that evidence halts are terminal for operators
   without insider trailer knowledge; today's remedy is hand-authored empty commits with
   exact trailer grammar (`docs/runbooks/evidence-backfill-recovery.md`). The lane's
   machinery should be manually invocable.
2. **Rollout safety** — a new gate-adjacent LLM lane must be arm-able/disarm-able
   without a code deploy. Precedent: `attribution_enforcement_cutover` (ISO-8601
   timestamp in committed `.ai-conductor/config.yml`, armed 2026-07-11T08:30Z).
3. **Model governance** — every dispatching step has a row in the generated HARNESS.md
   model table (source: `resolved-config.ts` + `model-table-metadata.ts`;
   `bin/generate-model-table`; CI enforces drift and opus-tier pins).

Repo release rules (CLAUDE.md): a PR that changes the `bin/conduct` CLI surface MUST
carry a CHANGELOG `## Migration` block; the migration-gate waiver is only for
internal-only edits, and an additive user-visible subcommand is not internal-only.

## Options Considered

### Option A: One `evidence` command group: `conduct-ts evidence judge <feature|worktree>`; timestamp cutover + percent sample key; model-table row `attribution_verify`
- **Pros:** one verifier, two invokers (gate + operator) — no drift between the repair
  path and the gate path; command group leaves room for #467's proposed
  `evidence backfill --verify` to join later; cutover shape is proven; model table stays
  the single governance point.
- **Cons:** new consumer-visible CLI ⇒ migration block obligation (accepted, it is real).

### Option B: No CLI; operators keep the manual runbook
- **Pros:** smaller diff.
- **Cons:** leaves #467's production-readiness gap open; the runbook's hand-authored
  trailer grammar is precisely the error-prone step the lane mechanizes.

### Option C: Boolean config flag instead of timestamp cutover
- **Pros:** simpler mental model.
- **Cons:** diverges from the `attribution_enforcement_cutover` precedent; a timestamp
  gives an auditable arming moment and lets a committed config arm a fleet at a chosen
  instant (the shape operators already know).

## Decision

**Option A.**

1. **CLI:** `conduct-ts evidence judge <feature-slug-or-worktree-path>` runs the SAME
   lane end-to-end — residue resolution, input assembly, fresh-session verifier,
   fail-closed parse, engine-side citation validation, engine-only stamping — against
   the named feature's worktree/branch, then re-runs the gate derivation and prints the
   before/after verdict as JSON. `--dry-run` stops after validation and prints what
   WOULD be stamped (no sidecar write). The command refuses to run while that feature's
   build step is active (single-writer discipline on the sidecar). Manual invocation
   bypasses the cutover flag (an operator explicitly asking is the authorization) but
   never bypasses validation — the no-whitewash rules are identical in both invokers.
   When a manual run FULLY resolves a halted/parked build's residue, the command also
   performs the recovery tail the runbook prescribes: HALT-clear plus REKICK sentinel
   drop, so the daemon re-picks the feature without further operator steps (partial
   resolution leaves halt state untouched and says so).
   **#467 is subsumed** (operator decision, issue #520 comment 2026-07-11): this judge
   CLI IS the systematized evidence backfill, with verification built in instead of
   blind stamping — recommend closing #467 as folded into #520 when the spec merges;
   any remaining halt-message UX gap gets its own narrow issue.
2. **Config keys** (committed `.ai-conductor/config.yml`, read at startup like their
   precedent):
   - `attribution_judge_cutover: <ISO-8601>` — gate-triggered lane arms when the
     timestamp has passed. Unset/future = lane inert (gate behaves exactly as today).
   - `attribution_audit_sample_pct: <0-100>` — spot-audit rate
     (adr-2026-07-11-attribution-spot-audit-measurement); `0` disables; default 10.
3. **Model table:** new step id `attribution_verify` in `DEFAULT_STEP_MODELS` /
   `DEFAULT_STEP_EFFORT` (`opus` / `high`) + rationale row in
   `model-table-metadata.ts` ("fresh-session judge attributing residue diffs to plan
   tasks — same adversarial-judgement class as build-review"), table regenerated via
   `bin/generate-model-table` in the same diff (CI drift check).
4. **Release obligations (recorded now so the build PR cannot miss them):** the
   implementation PR carries a CHANGELOG `## Migration` block covering the new CLI
   subcommand and the two config keys (with safe defaults documented: absent keys =
   feature inert). MINOR semver (new gate machinery + CLI, no breaking change).

## Consequences

### Positive
- #467's recovery gap closes with the same tested code path the gate uses — the manual
  runbook shrinks to "run `conduct-ts evidence judge <feature>`".
- Fleet-safe rollout: merge dark, arm by config commit, disarm by config commit.
- Model/effort governance stays in the one generated table.

### Negative
- Migration-block + model-table + README/docs obligations enlarge the implementation PR
  (they are the documented cost of touching these surfaces).
- A CLI-invoked judge on a stale local checkout can stamp against a worktree the daemon
  is about to prune; the active-build refusal narrows but does not eliminate
  operator-vs-daemon races (single-daemon-per-repo remains the operating assumption).

### Follow-up Actions
- [ ] Implement `evidence judge` command + `--dry-run` + active-build refusal.
- [ ] Add config keys with inert defaults; document in README + src/conductor/README.md.
- [ ] Add `attribution_verify` model-table row; regenerate table in the same diff.
- [ ] Draft the Migration block in the implementation PR's CHANGELOG entry.
