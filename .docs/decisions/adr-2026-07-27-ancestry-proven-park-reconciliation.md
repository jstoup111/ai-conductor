# ADR: Ancestry-proven parked-feature auto-reconciliation with config kill-switch

Status: APPROVED
Date: 2026-07-27
Refs: jstoup111/ai-conductor#1060

## Context

Parked features (`.daemon/parked/<slug>`) accumulate forever: 15 of 17 current parks target already-CLOSED issues. Two subclasses exist — branches fully merged into `origin/main` whose worktree/park entry rotted, and true orphans (issue closed elsewhere, branch not merged) stalled on transient halts. Per the harness Design Principle this must be deterministic machinery, not operator prose.

Conflict-check surfaced three accepted contracts this design must reconcile with:

- The operator-park PRD (`2026-07-04-operator-park.md`, Non-Goals) states "a park ends only by operator action", and its accepted stories carry a grep-level Done-When that no daemon code path removes `.daemon/parked/` markers.
- ST-916 shipped-record enforcement reserves `.docs/shipped/` record creation to a record-only repair PR derived from a proven merged implementation PR; it forbids invented `pr`/`spec_hash` values and automated writes reaching main.
- `mid-loop-pipeline-wipe-549` Story 5 audits that no cleanup path removes a `.pipeline` root belonging to an in-progress run ("parked" ≠ "no live run").

**Operator decision (2026-07-27, this session):** ship the full hybrid NOW — autonomous reconciliation of ancestry-proven-merged parks enabled by default, controllable by a config toggle; the operator-park contract is amended in this same spec; no phased rollout, no follow-up.

## Decision

1. **Periodic sweep.** `reconcileParkedFeatures` runs in `sweepBestEffort()` (startup + each idle tick), injected as an optional daemon dep exactly like `reconcileHaltPrs` (absent dep = no-op, never throws, per-slug error isolation, outcome-cache log suppression). Per parked slug it classifies:
   - **merged** — `git merge-base --is-ancestor feature/<slug> origin/main` proves the branch tip is contained in main (verified naming: `worktree.ts:48`; is-ancestor idiom: `push-evidence.ts:70-85`).
   - **orphan** — issue from `.docs/intake/<slug>.md` `Source-Ref:` is closed AND the branch is not an ancestor (or absent). Uses the shared sourceRef parser (`parseIntakeSourceRef` / the intake brain-sweep's shared parse) — never a new parser, never slug-string inference. Orphans are surfaced on the dashboard as `orphan — needs manual review`; they are NEVER deleted.
   - no marker / unparseable ref / git or `gh` failure → no classification, no action (fail-closed toward inaction).

   *Amended 2026-08-01 by `adr-2026-08-01-multi-proof-park-deletion-authority`: `merged` also
   includes a branch whose current tip is the `headRefOid` of its MERGED pull request; the two
   deletion proofs are equal-strength. See that ADR for the complete authority set.*

2. **Auto-reconcile (default ON) via `reconcile_parked_auto_cleanup` (boolean, default `true`).** With the toggle on, the sweep passes each merged-classified slug to the guarded cleanup helper. With the toggle off, the sweep only annotates merged parks as `merged — ready to reconcile` and takes no destructive action. The toggle changes who initiates, never what is checked.

3. **Git ancestry is the ONLY deletion authority.** All deletion flows through one guarded helper that accepts exactly ONE explicit slug, rejects globs/lists/paths, and re-verifies ancestry itself immediately before any destructive step (never trusts the caller's or the sweep's cached classification). Issue state, artifact content hashes, and slug text never authorize deletion. No force flag exists anywhere.

   *Amended 2026-08-01 by `adr-2026-08-01-multi-proof-park-deletion-authority`: deletion authority
   is the equal-strength set of ancestry and merged-PR head identity, rather than ancestry alone.
   The single-slug scope, point-of-deletion re-verification, record-as-precondition, and no-force
   requirements remain unchanged.*

4. **Records are never invented; record-on-main is a deletion precondition.** The helper deletes worktree/branch/marker only when `.docs/shipped/<slug>.md` already exists on the base branch. When missing, it resolves the actual merged implementation PR (e.g. `gh pr list --state merged --head feature/<slug>`); if resolvable it hands record creation to the ST-916 record-only repair-PR seam (real `pr` URL, canonical hash derivation) and defers cleanup to a later pass ("not reconcilable until the record lands"); if no merged PR is resolvable it reports and makes zero record writes (ST-916-5 NP2). Nothing here commits to main or merges anything.

5. **In-flight guard.** The helper refuses to remove a worktree whose `.pipeline/` belongs to an in-progress run (park-over-live-run is legal), satisfying the mid-loop-pipeline-wipe audit.

6. **Unpark ordering.** Marker removal is the helper's LAST step and goes through the unpark implementation, using its accepted missing-worktree fallback for the no-evidence-counter reset; a genuine reset failure leaves the marker in place (never half-unparked) and the slug is re-examined next pass.

7. **Operator verb.** `conduct daemon reconcile-parked <slug>` invokes the same helper manually — the safe replacement for ad-hoc `rm -rf`/`git branch -D`. Detected pre-boot beside `daemon park|unpark` AND added to the `bin/conduct` known-subcommand forwarding list (per the unknown-subcommand guard stories). Useful regardless of toggle state (e.g. toggle off, or reconciling one slug immediately).

8. **Operator-park contract amendment (same spec diff).** The operator-park PRD Non-Goals and the FR-7 single-writer story are amended to carry exactly one scoped exception: the guarded reconcile helper may remove the park marker of an ancestry-proven-merged, record-on-main park when `reconcile_parked_auto_cleanup` is enabled (its default) or when invoked via the operator verb. All other autonomous unpark remains forbidden; the grep-level single-writer assertion is re-scoped to "no daemon code path outside the guarded reconcile helper".

## Consequences

- Merged parks self-heal by default; the parked set converges to genuinely-blocked work plus visibly-labeled orphans. Operators who want manual control set `reconcile_parked_auto_cleanup: false` and use the verb.
- The daemon gains its first autonomous branch deletion — bounded by a machine-checkable ancestry proof, a record-on-main precondition, an in-flight guard, and single-slug scope, re-verified at the point of deletion.
- The guarded single-slug helper is the first piece of the guarded-delete machinery CLAUDE.md names as not-yet-built.
- Remote/tracker unavailability degrades to inaction, never to a guess. `gh` usage is bounded: issue-state lookups only for non-ancestor parks, outcome-cached across ticks.
- The operator-park invariant is deliberately narrowed by this ADR; the amendment travels in the same reviewable spec diff, and toggle-off restores the prior invariant in full.

## Alternatives rejected

- **Surface-only sweep, deletion only via operator verb** — leaves the leak by default; operator explicitly rejected the phased rollout ("hybrid now for all — no follow-up").
- **Sweep writes shipped records directly** — manufactures exactly the invented-record artifact ST-916 enforcement refuses; record creation stays delegated to the ST-916 repair-PR seam.
- **Content-hash artifact comparison as delete signal** — weaker than ancestry; redundant with `spec_hash` dedup in `daemon-backlog.ts`.
- **Issue state as deletion authority** — remote heuristic; issue state only ever labels, never deletes.
