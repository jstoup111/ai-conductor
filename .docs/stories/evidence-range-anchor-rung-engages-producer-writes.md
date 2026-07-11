**Status:** Accepted

# Stories: Evidence-range anchor rung — distinguish absent anchor from stale anchor

Technical track (no PRD) · Tier S · intake jstoup111/ai-conductor#510
Source of intent: intake #510 ("Evidence-range anchor is always empty — primary
anchor rung never engages, merge-base fallback carries every derivation").

Root cause: `getEvidenceRange` (`src/conductor/src/engine/autoheal.ts:370`) runs
the anchor reachability probe on the empty-string sentinel that every production
gate call supplies (`autoheal.ts:762`), so an ABSENT anchor is logged as if it were
a recorded-but-unreachable anchor (`autoheal.ts:380`, `anchor  is unreachable`,
empty value + doubled space) on 100% of derivations.

---

## Story: A present, reachable anchor produces `anchor..HEAD` with no warning

**Requirement:** intake #510 desired outcome 1 (healthy build → zero
`anchor … unreachable` lines)

As the conductor engine, I want a caller-supplied, reachable anchor to be used
directly as the evidence-range lower bound so that the primary anchor rung engages
cleanly and the derivation emits no spurious warning.

### Acceptance Criteria

#### Happy Path
- Given a git repo where commit `A` is reachable from `HEAD` and a resolvable origin
  default branch, when `getEvidenceRange(root, A)` runs, then the derived range is
  `A..HEAD`, `result.warnings` is empty, and `result.anomalies` is empty.
- Given the same call, when it completes, then NO log line containing `unreachable`
  is emitted (the anchor-reachable branch never enters the fallback).
- Given the returned commits, when compared against `git log A..HEAD`, then they are
  exactly equal (behavior of the reachable-anchor rung is unchanged from today).

### Done When
- [ ] A `getEvidenceRange` test asserts that a reachable explicit anchor yields
      `A..HEAD`, zero warnings, and zero `unreachable` log output.

---

## Story: An absent anchor derives the branch base and logs "no recorded anchor" — never "unreachable"

**Requirement:** intake #510 desired outcomes 1 & 2 (healthy build → no warn;
absence is logged distinctly, not rendered as an empty stale value)

As the conductor engine, I want the empty-anchor sentinel (the value every
production gate call supplies) to be recognized as "no recorded anchor" and routed
straight to branch-base derivation so that the misleading `anchor  is unreachable`
warning stops firing on every gate walk, while absence remains visible in the log as
a distinct, quiet line.

### Acceptance Criteria

#### Happy Path (the production gate path)
- Given a git repo with a resolvable origin default branch and branch commits ahead
  of it, when `getEvidenceRange(root, '')` runs (empty anchor), then the reachability
  probe (`git rev-parse --verify '^{commit}'`) is NOT executed against the empty
  sentinel, and the range is `<merge-base>..HEAD` — identical to today's fallback
  result.
- Given the same call, when it completes, then `result.warnings` contains NO line
  matching `unreachable`; instead a single distinct line naming the absence (e.g.
  `Evidence range: no recorded anchor; deriving branch base`) is recorded — and it is
  informational, not a `[warn]` (so it does not read as a fault and can be filtered
  as routine).
- Given a whitespace-only anchor (`'   '`), when `getEvidenceRange` runs, then it is
  treated identically to the empty sentinel (absent, not unreachable) — the probe is
  skipped and no `unreachable` warning is emitted.
- Given the returned commits, when compared against the plain merge-base range, then
  they are exactly equal (results and fallback behavior unchanged — intake outcome 3).

### Done When
- [ ] A `getEvidenceRange` test asserts `getEvidenceRange(root, '')` produces
      `<merge-base>..HEAD`, zero `unreachable` warnings, and one distinct
      no-recorded-anchor log line that does NOT contain the substring `unreachable`
      and does NOT render an empty anchor value.
- [ ] A test asserts a whitespace-only anchor is handled as absent (no `unreachable`
      warning).
- [ ] The existing `deriveCompletion(root, planPath)` gate path (no anchor) is
      exercised end-to-end and produces zero `unreachable` lines while returning the
      same completion map as before.

---

## Story: A genuinely recorded-but-unreachable anchor still falls back, naming the bad SHA

**Requirement:** intake #510 desired outcome 3 (a genuinely stale/unreachable
recorded anchor still falls back exactly as today, and the line names the value)

As the conductor engine, I want a NON-EMPTY anchor SHA that is not reachable from
`HEAD` to keep falling back to merge-base with a warning that names the offending
SHA so that a genuinely stale recorded anchor stays diagnosable and distinct from
absence.

### Acceptance Criteria

#### Negative Path
- Given a non-empty anchor SHA (e.g. `deadbeef…`) that is unreachable from `HEAD`,
  when `getEvidenceRange(root, sha)` runs, then it falls back to merge-base and
  records exactly one warning that (a) contains `unreachable`, (b) names a non-empty
  anchor value (the SHA short form), and (c) has no doubled space / empty value — the
  #510 empty-value shape can never be produced by this branch.
- Given that same unreachable non-empty anchor, when the derivation completes, then
  the resulting range and commit set are identical to today's merge-base fallback
  (no regression to the negative path).
- Given origin default cannot be resolved AND the anchor is absent, when
  `getEvidenceRange(root, '')` runs, then it fails closed (zero commits + an anomaly)
  exactly as today — the absent-anchor handling never weakens the fail-closed
  contract.

### Done When
- [ ] A test asserts a non-empty unreachable SHA still emits one `unreachable`
      warning whose text contains the non-empty short SHA and contains no
      empty/doubled-space anchor rendering.
- [ ] A test asserts the merge-base fallback range/commits for an unreachable
      non-empty anchor are unchanged from the pre-fix behavior.
- [ ] The fail-closed path (unresolvable origin default) is asserted still to return
      zero commits with an anomaly when the anchor is absent.

---

## Non-goals

- Wiring a new anchor-recording producer for the gate path (seed-time or
  branch-creation write). Branch-base derivation is the correct gate boundary by
  design (#456, `autoheal.ts:756-761`) and the intake's outcome #2 treats an absent
  anchor as a legitimate steady state. Tightening the boundary with a recorded anchor
  is a separate, larger enhancement out of scope here.
- Changing derivation results, the merge-base ladder, or the fail-closed contract.
