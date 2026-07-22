# Conflict Check: Relocate pipeline run-state to a home-dir store (#564)

**Date:** 2026-07-21
**Stories scanned:** `.docs/stories/pipeline-run-state-lives-inside-the-worktree-cwd-r.md` (TR-1…TR-10)
against all `.docs/stories/` + `.docs/specs/` + prior `.docs/conflicts/`.
**Result:** PASS — zero blocking conflicts. One accepted degrading overlap recorded below.

## Method

All 5 conflict types (contradiction, behavioral overlap, state, resource contention, sequencing)
were checked. Stories referencing `.pipeline` / run-state / cwd were enumerated and the genuinely
interacting pairs reasoned through explicitly (not assumed clean). The compatibility invariant that
keeps most pairs clean: **this change preserves the `.pipeline` path (now an outward symlink) and
the persistence primitives' `(path)`/`(dir)` signatures**, so every existing reader/writer of
`.pipeline/<file>` remains valid — only the resolved location behind the path changes.

## Overlap 1 (degrading, ACCEPTED — complementary): #564 vs #549 mid-loop `.pipeline` wipe

**Stories involved:** TR-4 (write-through), TR-6 (survives cwd-relative delete), TR-7 (fail-closed
identity, remove eager host-seed `mkdir`) vs `mid-loop-pipeline-wipe-549.md` Story 1 (guarded
marker write) + Story 2 (crash-handler `mkdir('.pipeline')` before `writeState`).
**Files:** `.docs/stories/pipeline-run-state-lives-inside-the-worktree-cwd-r.md` vs
`.docs/stories/mid-loop-pipeline-wipe-549.md`
**Type:** behavioral overlap (shared code regions: `step-runners.ts` marker write,
`conductor.ts` outer-catch crash handler, `index.ts` host-seed `.pipeline` ensure)
**Severity:** degrading (not blocking)

**Description:** #549 (APPROVED `adr-2026-07-11-pipeline-state-durability`, guarantees D1/D2/D3) is
the interim point-fix — it guards `.pipeline` writes and reorders the crash handler so a mid-run
wipe cannot crash the loop. #564 is the durable architectural fix that relocates run-state out of
the worktree so the wipe/worktree-removal cannot reach it. These are **complementary, not
contradictory**: after relocation, `pipelineDir` resolves to the home store, and #549's guarded
ensure-dir + crash-handler ordering still apply to that path as defense-in-depth. #564 does **not**
supersede `adr-2026-07-11-pipeline-state-durability`.

**Resolution (accepted, no operator decision required):**
1. #564's implementation MUST preserve #549's D1/D2/D3 guarantees against the relocated path —
   the guarded ensure-dir and crash-handler ordering keep working, now targeting the store.
2. TR-7's removal/gating of the eager host-seed `mkdir(join(process.cwd(),'.pipeline'))` must not
   regress #549 Story 2's crash-handler `mkdir` (which now mkdir's the resolved store path — still
   valid).
3. No superseding ADR is created; both ADRs coexist (relocation + guards).

**Recommendation:** Accept as complementary. Carried into `/plan` as a coordination constraint on
the tasks that touch `step-runners.ts`, `conductor.ts`, and `index.ts`.

## Checked-clean pairs (no conflict)

- **vs #534 `park-and-unpark-resolve-the-repo-root-from-any-cwd`:** disjoint resource — #534
  governs `.daemon`/`.docs`/`.worktrees` resolution via `git-common-dir`; #564 governs `.pipeline`
  run-state via feature identity + home dir. Same anti-cwd principle, no contention.
- **vs `adr-2026-06-29-shared-memory-store-placement-and-durability`:** #564 reuses its pattern and
  explicitly diverges on keying (project+slug vs project-only) — documented in
  `adr-2026-07-21-run-state-home-dir-placement`, not a conflict.
- **All other `.pipeline`-referencing stories** (evidence, audit-trail, finish, daemon-*, etc.):
  read/write `.pipeline/<file>` via unchanged primitive signatures through the preserved `.pipeline`
  path — no location assertion contradicted.

## Verdict

Zero blocking conflicts. Proceed to `/plan`. The #549 overlap is an accepted, complementary
coordination constraint, recorded here and carried into the plan.
