# auto-park empty/missing-plan check false-positives on a completed build with a present plan

Status: Accepted

## Context

On 2026-07-12 06:47–06:49Z the S-tier feature
`park-and-unpark-resolve-the-repo-root-from-any-cwd` (sourceRef jstoup111/ai-conductor#534)
completed a full 5/5 build — `.pipeline/task-status.json` showed all five tasks `completed`, each
with a real commit on the branch, and every commit carried a clean, singular `Task: N` trailer.
Despite that, the daemon auto-parked it at `build` with reason **`empty/missing plan`**
(jstoup111/ai-conductor#578), and `.pipeline/task-evidence.json` `evidenceStamps` was completely
empty.

Root cause (empirically reproduced against the parked worktree):
`parsePlanTaskPaths` in `src/conductor/src/engine/autoheal.ts:1077` uses
`/^#{1,6}\s+Task\s+([A-Za-z0-9._,\s-]+?)(?::|$)/`, whose captured task id must end at a colon or
end-of-line. The plan's headings are `### Task N — <title>` (em-dash `—`, no colon). The em-dash is
outside the id character class and no `:`/`$` is reachable, so the regex fails and the plan yields
**zero** task ids. `parsePlanTaskPaths` is the single id source for both:

- the build completion predicate (`CUSTOM_COMPLETION_PREDICATES.build`, `artifacts.ts`), which then
  returns `{ done:false, reason:'no tasks in plan' }`; the daemon's `emptyPlan` derivation
  (`conductor.ts:2115-2119`) matches `'no tasks in plan'` → `emptyPlan = true` → auto-park as
  `empty/missing plan`; and
- `deriveCompletion` (`autoheal.ts:596`), which iterates over the same empty id set and therefore
  stamps nothing — explaining the wholesale-empty `evidenceStamps`.

The gate's own plan-presence check (`artifacts.ts:676`,
`/^#{1,6}\s+Task\s+[A-Za-z0-9._-]+/im`, no terminator) and the sibling parsers `parsePlanTasks`
and `evidence-cli`'s heading regex all accept the em-dash form; only `parsePlanTaskPaths` rejects
it. 7 of the 121 plans in the corpus use the em-dash heading form and are exposed to this
false-park. Fix: widen `parsePlanTaskPaths`'s terminator to accept a whitespace-preceded
em-dash/en-dash separator, matching the `### Task N — Title` authoring convention.

## Story 1 — a completed build whose plan uses em-dash Task headings is not auto-parked as empty-plan

As the daemon, when a build completes N/N with a well-formed plan whose task headings are written
`### Task N — Title` (em-dash, no colon), I recognize the plan's tasks so the build passes the
completion gate and is never auto-parked as having an "empty/missing plan".

### Happy Path

- **Given** a well-formed plan whose task headings use the `### Task N — Title` em-dash form (no
  colon) and whose every task is evidenced by a commit carrying a clean `Task: N` trailer,
- **When** the daemon evaluates the build completion gate,
- **Then** `parsePlanTaskPaths` returns the full set of task ids (not empty), the build predicate
  does **not** return `no tasks in plan` / `plan is empty`, the derived `emptyPlan` is **false**,
  and no `empty/missing plan` auto-park marker is written for a build that reached N/N.
- **And** the same widened parse also stamps evidence for those ids in `deriveCompletion`
  (`evidenceStamps` is populated, not empty), so the completed tasks are recognized as resolved.
- **And** the existing colon form (`### Task N: Title`), the bare form (`### Task N`), numeric
  ranges (`### Task 1-3 …`), comma-lists (`### Task 1, 2 …`), and alphanumeric ids
  (`### Task rem-adr-001: …`) continue to parse to exactly the same ids as before (no regression).

## Story 2 — a genuinely empty or missing plan still auto-parks as empty/missing plan

As the daemon, when the plan truly has no task headings (or the plan file is absent), I still fail
the completion gate with an empty-plan reason and still take the `empty/missing plan` auto-park
path, so the real trigger for that park is preserved.

### Negative Path — plan present but contains no task headings

- **Given** a plan file that is present but contains **no** `### Task …` headings of any form,
- **When** the daemon evaluates the build completion gate,
- **Then** `parsePlanTaskPaths` returns an empty id set, the build predicate returns an empty-plan
  reason (`plan is empty …` or `no tasks in plan`), the derived `emptyPlan` is **true**, and the
  feature is auto-parked with reason `empty/missing plan` exactly as before this fix.

### Negative Path — em-dash separator must not over-capture the id

- **Given** an em-dash heading such as `### Task 1 — A-3: remove the assertion` (an em-dash title
  that itself later contains a colon),
- **When** `parsePlanTaskPaths` parses it,
- **Then** the captured id is exactly `1` (terminated at the em-dash), **not** `1 — A-3` or any
  span crossing the em-dash, so downstream evidence matching keys off the correct id.
