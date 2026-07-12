# Stories: judged-attribution-verdict-persistence

**Source:** jstoup111/ai-conductor#581 · **Track:** technical · **Tier:** M

Derived from the technical intent (no PRD). Each story carries happy and negative paths.
"The gate" = the build-step completion decision at `conductor.ts:2012`. "The lane" =
`runAttributionLane`. Stamps = `.pipeline/task-evidence.json` entries; task-status =
`.pipeline/task-status.json`.

---

## Story 1 — A fully-covered residue build advances on the same attempt (happy path)

**As** the conductor build gate, **I want** the judge lane's satisfied verdicts to be
re-read into completion within the same attempt, **so that** a residue build the judge
finds fully covered advances instead of halting.

- **Given** an armed judge cutover, a build-gate miss with residue tasks, and a verifier
  verdict marking every residue task `satisfied` with citations that pass validation and
  passing scoped tests,
  **When** the lane runs and persists `semantic-verified` stamps for those tasks,
  **Then** the gate re-evaluates completion in the same attempt and reports `done`, and
  the build advances past the build gate with no HALT and no operator action.

- **Given** the same setup but this is the final retry attempt (retries exhausted),
  **When** the lane stamps all residue tasks satisfied,
  **Then** the build still advances on this attempt (the rescue does not depend on a
  "next cycle" that will never run).

---

## Story 2 — No-whitewash: unsatisfied / no-verdict / refused still halt (negative path)

**As** the conductor build gate, **I want** non-satisfied verdicts to change nothing,
**so that** uncovered work can never be whitewashed into shipping.

- **Given** a build-gate miss where the verifier returns `no-verdict` for a residue task
  (e.g. no citable sha),
  **When** the lane runs,
  **Then** that task receives no stamp, the in-cycle re-check still reports the gate not
  done, and the build refuses (retries or HALTs) exactly as before this change.

- **Given** a verifier verdict of `satisfied` whose citations FAIL `validateCitations`
  (cited sha does not touch the task's declared paths, or is a bookkeeping/empty commit),
  **When** the lane processes it,
  **Then** the task is refused (no stamp), and the gate does not advance on its account.

- **Given** a mix of satisfied and unsatisfied residue tasks,
  **When** the lane stamps only the satisfied ones,
  **Then** the re-check reports not done (unsatisfied tasks remain incomplete) and the
  build refuses — partial coverage never advances the gate.

---

## Story 3 — Semantic-verified stamp outranks a mis-attributed trailer (precedence, negative path)

**As** completion derivation, **I want** a `semantic-verified` stamp to be honored even
when a mis-attributed trailer commit exists for the same task, **so that** the #576
wrong-trailer residue case does not silently discard the judge's validated verdict.

- **Given** task N has a `semantic-verified` sidecar stamp AND a `Task: N` trailer commit
  that fails path corroboration (its files do not overlap N's declared paths — e.g. the
  commit actually implemented a different task),
  **When** `deriveCompletion` runs,
  **Then** task N is treated as completed on the strength of the `semantic-verified`
  stamp (not demoted by the failed trailer corroboration).

- **Given** task N has NO stamp and only a trailer commit that fails path corroboration,
  **When** `deriveCompletion` runs,
  **Then** task N remains incomplete (the precedence rule only elevates a real
  `semantic-verified` stamp — it never invents coverage).

---

## Story 4 — Re-check is triggered only by real stamps (negative / guard path)

**As** the conductor build gate, **I want** the in-cycle re-check to fire only when the
lane actually stamped tasks, **so that** the fix adds no spurious re-derivation and no
path to `done` without a stamp.

- **Given** the lane runs but stamps zero tasks (`stampedTaskIds` empty — all refused or
  no-verdict),
  **When** the gate-miss branch continues,
  **Then** no extra completion re-check is performed and the gate decision uses the prior
  `completion` value (behavior identical to today).

- **Given** the cutover is absent (default),
  **When** a build-gate miss occurs,
  **Then** the lane is skipped, no re-check is added, and the whole flow is byte-identical
  to pre-change behavior.

---

## Story 5 — Stale-anchor verdicts remain fail-closed (negative path)

**As** the lane, **I want** a verdict produced against a different HEAD to coerce to
no-verdict, **so that** a stale verdict from a prior cycle can never stamp coverage.

- **Given** an `attribution-verdict.json` whose `anchor.head` differs from the current
  HEAD,
  **When** the lane parses it,
  **Then** all verdicts coerce to `no-verdict`, nothing is stamped, and the in-cycle
  re-check does not advance the gate.

---

## Acceptance signals (observable)

- A residue build with an all-satisfied, validated verdict advances past the build gate
  with no operator action (Story 1) — provable in an integration test that arms the
  cutover, injects a satisfied verdict, and asserts the gate flips to done on the same
  attempt.
- A `no-verdict`/`unsatisfied`/refused task never advances the gate (Stories 2, 4).
- A `semantic-verified` stamp survives a failed trailer corroboration for its task
  (Story 3).
- Default (cutover-absent) behavior is byte-identical (Story 4).

Status: Accepted
