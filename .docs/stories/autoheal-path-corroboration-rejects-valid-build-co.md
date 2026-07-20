**Status:** Accepted

# Stories: Autoheal path-corroboration bounded dirname pass (#707)

**Track:** technical (no PRD — acceptance criteria derived from the technical intent and the
APPROVED ADR `adr-2026-07-20-bounded-dirname-path-corroboration`).
**Scope note:** every story below is about the path-corroboration matcher
(`fileMatchesPlanPath` / `filesOverlappingTaskPaths` → `deriveCompletion` in
`src/conductor/src/engine/autoheal.ts`). The semantic attribution judge lane is explicitly
out of scope and must be left unchanged.

---

## Story: Credit a subsystem-local commit via the bounded dirname pass

**Requirement:** ADR decision — bounded dirname/subsystem corroboration branch

As the build engine, I want a commit that carries a valid `Task: N` trailer and lands a file in
the same immediate directory as one of task N's plan-declared paths to corroborate task N, so
that legitimate work in the right subsystem is credited instead of stalling at `no_task_progress`.

### Acceptance Criteria

#### Happy Path
- Given task N declares plan path `src/conductor/src/engine/conductor.ts`, and a commit carries
  trailer `Task: N` and touches `src/conductor/src/engine/build-stall.ts` (same immediate parent
  dir, not an exact/suffix match), when `deriveCompletion` runs, then task N is marked
  `completed` with `evidencedBy` set to that commit's SHA.
- Given the same commit credits task N, when the evidence sidecar is written, then task N's stamp
  records a corroboration form distinct from exact/suffix (`trailer-dirname`), so later gate runs
  and `task-status.json` rows agree on how it was credited.

#### Negative Paths
- Given a commit carries trailer `Task: N` but every one of its files is empty/unreadable (no
  diff), when `deriveCompletion` runs, then task N is NOT credited by the dirname pass (an
  empty-commit trailer alone never completes a task — existing behavior preserved).
- Given task N declares no plan paths at all, when a `Task: N` commit is evaluated, then the
  trailer-alone completion rule applies unchanged (the dirname pass is only reached when the task
  HAS plan paths and exact/suffix missed).

### Done When
- [ ] `deriveCompletion` credits a task when a `Task:`-trailered commit touches a file whose
      immediate parent dir equals a plan-declared path's immediate parent dir.
- [ ] The evidence stamp for such a credit is recorded with the `trailer-dirname` form (not
      `trailer` and not `semantic-verified`).
- [ ] A unit test asserts the dirname credit + stamp form on a fixture repo.

---

## Story: Preserve exact and suffix corroboration unchanged (regression)

**Requirement:** ADR — "in ADDITION to today's exact/suffix match"

As the build engine, I want the existing exact-match and suffix-match corroboration to behave
byte-for-byte as before, so that adding the dirname pass introduces no regression to the
common path.

### Acceptance Criteria

#### Happy Path
- Given task N declares `src/x/y.ts` and a commit `Task: N` touches exactly `src/x/y.ts`, when
  `deriveCompletion` runs, then task N is credited with stamp form `trailer` (exact), exactly as
  before this change.
- Given task N declares `y.ts` and a commit `Task: N` touches `src/x/y.ts` (suffix `endsWith('/y.ts')`),
  when `deriveCompletion` runs, then task N is credited with stamp form `trailer` (suffix), exactly
  as before.

#### Negative Paths
- Given a commit matches a plan path by exact/suffix, when it is credited, then the dirname branch
  is NOT what produced the credit (the stamp form is `trailer`, not `trailer-dirname`) — the exact/
  suffix result short-circuits before the dirname pass.

### Done When
- [ ] Pre-existing exact/suffix corroboration tests still pass unmodified.
- [ ] Stamp form for an exact/suffix credit remains `trailer`.

---

## Story: Bound the dirname match to the immediate parent dir (#445 non-regression)

**Requirement:** ADR decision + Risk register (High-impact: #445 regression)

As the build engine, I want the dirname pass to match ONLY the immediate parent directory of a
plan-declared path — never a distant ancestor and never the repo root — so that #445's "same as
Task N" inheritance false-positive is not reopened.

### Acceptance Criteria

#### Happy Path
- Given task N declares `src/conductor/src/engine/conductor.ts` (immediate parent
  `src/conductor/src/engine`), when a `Task: N` commit touches
  `src/conductor/src/engine/autoheal.ts`, then task N IS credited (same immediate parent dir).

#### Negative Paths
- Given task N declares `src/conductor/src/engine/conductor.ts`, when a `Task: N` commit touches
  only `src/conductor/src/cli.ts` (shares the ancestor `src/conductor/src` but NOT the immediate
  parent `.../engine`), then task N is NOT credited by the dirname pass.
- Given task N declares `src/conductor/src/engine/conductor.ts`, when a `Task: N` commit touches
  only a top-level file such as `README.md` or `VERSION` (shares only the repo root), then task N
  is NOT credited by the dirname pass.
- Given task N's plan-declared paths were INHERITED from another task's declared Files (the #445
  scenario), when a commit touches files in a directory unrelated to task N's real work, then the
  dirname pass does NOT credit task N (the bound plus the `Task: N` trailer precondition together
  prevent the inheritance false-positive).

### Done When
- [ ] The matcher compares immediate parent directories only (`dirname(file) === dirname(planPath)`);
      no ancestor-prefix or repo-root match path exists in the code.
- [ ] A test proves an ancestor-only and a repo-root-only overlap are BOTH rejected.
- [ ] A #445-shaped inheritance test confirms no false-positive credit.

---

## Story: Do not credit a commit whose files are in the wrong immediate directory

**Requirement:** ADR — dirname pass is corroboration, not a blanket accept

As the build engine, I want a `Task: N` commit whose files' immediate parent directories differ
from every plan-declared path's immediate parent dir to fall through the dirname pass, so that a
mis-placed or mis-trailered commit is not wrongly credited.

### Acceptance Criteria

#### Happy Path
- Given task N declares paths only under `src/conductor/src/engine/`, when a `Task: N` commit
  touches only files under `test/` and `docs/`, then the dirname pass does NOT credit task N and
  evaluation falls through to the unchanged judge/reject path.

#### Negative Paths
- Given the dirname pass misses for task N and no `semantic-verified` stamp exists, when
  `deriveCompletion` finishes, then task N remains incomplete and the existing
  `Path corroboration failed` audit entry + `warnOnce` fire exactly as today.

### Done When
- [ ] A commit whose files share no immediate parent dir with any plan-declared path is not
      credited by the dirname pass.
- [ ] The audit-entry + warnOnce reject behavior is unchanged on a full miss.

---

## Story: Preserve the semantic judge fallback path unchanged (interaction)

**Requirement:** ADR — judge lane left byte-for-byte unchanged; #707 is the deterministic complement

As the maintainer, I want the semantic attribution judge lane to behave identically after this
change, so that #707 neither duplicates nor suppresses the work completed in #700.

### Acceptance Criteria

#### Happy Path
- Given the dirname pass misses for task N but a `semantic-verified` stamp already exists for it
  (judge lane credited it), when `deriveCompletion` runs, then task N is credited via the existing
  `semantic-verified` branch, exactly as before.

#### Negative Paths
- Given the dirname pass CREDITS task N, when evaluation proceeds, then the judge lane is not
  required to act on task N (it is no longer residue) — the deterministic pass ran first, honoring
  the determinism-first principle.
- Given the change is applied, when the code is reviewed/diffed, then `attribution-lane.ts` and the
  conductor's judge-dispatch block are unmodified (no lines changed in the judge lane).

### Done When
- [ ] The `semantic-verified` credit branch is unchanged and still credits when a stamp exists.
- [ ] The diff touches no judge-lane code (`attribution-lane.ts`, conductor judge-dispatch block).

---

## Story: Deterministic credit works with the judge cutover OFF (degradation)

**Requirement:** ADR — dirname pass is independent of `attribution_judge_cutover`

As an operator on a repo where `attribution_judge_cutover` is absent/inactive, I want legitimate
subsystem-local commits still credited deterministically, so that the stall class is fixed even
where the LLM judge never runs — with no new false positives.

### Acceptance Criteria

#### Happy Path
- Given `attribution_judge_cutover` is inactive (judge lane never dispatches), when a `Task: N`
  commit touches a file in the same immediate dir as a plan-declared path, then the dirname pass
  credits task N deterministically.

#### Negative Paths
- Given cutover is inactive and the dirname pass also misses, when `deriveCompletion` finishes,
  then task N is rejected exactly as today (no new false positives introduced by the change with
  the judge off).

### Done When
- [ ] A test with the judge lane disabled proves the dirname credit still occurs.
- [ ] A test with the judge lane disabled proves a full miss still rejects (unchanged).

---

## Story: Require a real, unambiguous Task trailer as a precondition

**Requirement:** ADR — `taskTrailerMatches` precondition unchanged

As the build engine, I want the dirname pass to only ever apply to commits that already match the
task's `Task: N` trailer, so that a commit with no matching (or an ambiguous) trailer is never
credited by directory proximity alone.

### Acceptance Criteria

#### Happy Path
- Given a commit carries an exact `Task: N` trailer (or an unambiguous alias per the existing
  `taskTrailerMatches`), when its files share task N's immediate plan dir, then the dirname pass
  may credit it.

#### Negative Paths
- Given a commit carries NO `Task:` trailer for task N, when its files happen to sit in task N's
  plan directory, then the dirname pass does NOT credit task N (trailer match is a precondition;
  directory proximity alone is never sufficient).
- Given a commit carries an AMBIGUOUS trailer that `taskTrailerMatches` rejects for task N, when
  its files sit in task N's plan directory, then the dirname pass does NOT credit task N.

### Done When
- [ ] `taskTrailerMatches` remains the gate before any dirname comparison (unchanged logic).
- [ ] Tests prove no-trailer and ambiguous-trailer commits are not credited by the dirname pass.
