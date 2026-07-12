# Stories: rebase-orphans-every-sha-anchored-evidence-citatio

**Source:** jstoup111/ai-conductor#535 · **Track:** technical · **Tier:** L
**ADR:** `.docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md`

## Story 1 — Build the old→new map from a file-changing rebase

- **Given** a feature branch whose commits `{onto}..ORIG_HEAD` are cleanly replayed onto a
  moved base as `{onto}..HEAD` (a `changed` rebase outcome),
  **When** `performRebase` completes,
  **Then** `translateAfterRebase` builds a map pairing each pre-image commit to its post-image
  commit by matching `git patch-id --stable`, indexes both full and 7-char forms, and persists
  it transitively to `.pipeline/rebase-rewrites.json`.
- **Given** a second rebase that rewrites `new` to `newer`,
  **When** the map is persisted,
  **Then** any prior value equal to `new` is repointed to `newer` (transitive closure holds).

## Story 2 — Translate the task-evidence sidecar in place

- **Given** `.pipeline/task-evidence.json` stamps whose `sha`, `citedShas[]`, and `verdictAnchor`
  reference pre-rebase commits,
  **When** translation runs,
  **Then** each field is rewritten to its post-rebase equivalent via the map (atomic temp+rename),
  and a before/after diff of the sidecar shows every mapped sha updated.

## Story 3 — Translate task-status commit fields (full and short)

- **Given** `.pipeline/task-status.json` records carrying a `commit` sha as a full 40-char value
  (`task-seed.ts:213`) and as a 7-char short value (`autoheal.ts:202`),
  **When** translation runs,
  **Then** both forms are mapped to the post-rebase sha; a short-form value maps via the short-form
  index and no full/short mismatch is left behind.

## Story 4 — Re-key the #520 judged-stamp memo instead of missing

- **Given** `.pipeline/attribution-memo.json` keyed `${oldHead}:${residueIds}` with
  `verdictAnchor:oldHead`,
  **When** an unconflicted rebase moves HEAD and every judged commit patch-id-matches,
  **Then** the memo key is recomputed onto the new HEAD and `verdictAnchor` is translated, so the
  next lane evaluation is a cache **hit** (no fresh opus re-judge).

## Story 5 — Resolve immutable satisfied-by trailer targets at read time

- **Given** an empty commit carrying `Evidence: satisfied-by <oldWorkSha>` whose target work
  commit was rewritten to `<newWorkSha>`,
  **When** `validateCitations` and the autoheal satisfied-by consumer evaluate it,
  **Then** they resolve `<oldWorkSha>` through the persisted map to `<newWorkSha>` before the
  `merge-base --is-ancestor` check, the citation validates on the rebased branch, and the trailer
  text itself is never rewritten.

## Story 6 — Both rebase sites are covered by one insertion point

- **Given** the finish-time site (`runRebaseStep`) and the rekick site (`resumeRebaseFirst`),
  **When** either performs a file-changing rebase,
  **Then** translation runs (both funnel through `performRebase`), and both sites' post-rebase
  stores are translated identically — proven by exercising each caller path.

## Story 7 — Unmappable citations surface as loud residue (negative/observability)

- **Given** a pre-image commit that is dropped during rebase, or conflict-modified so its
  patch-id changes,
  **When** the map is built,
  **Then** that commit and the task ids citing it are written to `.pipeline/rebase-residue.json`
  with a reason, and a `rebase_citation_residue` event is emitted — the citation is **not**
  silently repointed and **not** silently left dangling.

## Story 8 — No laundering: a never-on-branch citation is still refused (negative)

- **Given** a citation SHA that was never a pre-image commit of this branch (stale from an
  unrelated history, or forged),
  **When** translation and read-time resolution run,
  **Then** the SHA is **not** a map key, `resolveThroughMap` returns it unchanged, and the
  existing `merge-base --is-ancestor` check refuses it — translation never converts an off-branch
  or forged citation into an accepted one.

## Story 9 — Non-file-changing rebase and capability-absence are no-ops (negative/safety)

- **Given** a rebase whose outcome is `unchanged`/`noop`, or a caller that does not inject the
  translation capability (unit tests, legacy),
  **When** the rebase completes,
  **Then** no store is modified and no residue is written — behavior is byte-identical to today
  (fail-closed).

## Story 10 — Empty-commit `--empty` handling is verified, not assumed (negative/correctness)

- **Given** a task whose only evidence is an already-empty satisfied-by commit,
  **When** the sanctioned rebase runs,
  **Then** if git drops the empty commit the task's evidence resolves via the **mapped work-commit
  target** (not the unmappable empty-commit sha); if no work-commit target exists, the task goes to
  residue (loud) — and the actual `--empty` behavior is pinned by a scratch-repo test, never
  assumed.

---

## Acceptance signals (observable)

- Diffing `.pipeline/task-evidence.json` and `.pipeline/task-status.json` before/after a
  file-changing rebase shows every mapped sha repointed to its post-rebase equivalent (Stories 2, 3).
- A satisfied-by citation whose target was rewritten validates against the rebased HEAD without any
  operator re-pointing (Story 5).
- The judged-stamp memo hits (no re-judge) after an unconflicted rebase (Story 4).
- A dropped/conflict-modified citation appears in `.pipeline/rebase-residue.json` + event, never as
  a silent dangle (Story 7).
- A never-on-branch/forged citation is still refused post-translation (Story 8).
- `unchanged`/capability-absent paths are byte-identical to today (Story 9).

Status: Accepted
