# ADR: Operator park state — repo-root `.daemon/parked/<slug>` marker, checked before every autonomous decision

- **Status:** APPROVED
- **Approved by:** operator (James), 2026-07-04
- **Date:** 2026-07-04
- **Feature:** operator park (ai-conductor#236)
- **Related:** .docs/specs/2026-07-04-operator-park.md (FR-1..FR-7), adr-2026-07-04-park-unpark-cli-verbs.md

## Context

The base-advance re-kick sweep (`engine/daemon-rekick.ts`, ADR-013 lineage) clears every live
`.pipeline/HALT` on a genuine base-SHA advance. It cannot distinguish a machine-placed,
retry-worthy halt from a human "do not touch." The HALT body is rewritten by multiple writers
(`writeHalt` on rebase re-conflict, self-host gates, the finish flow), so any in-band annotation
of HALT can be silently clobbered — evidence: `daemon-rekick.ts:309` re-writes HALT wholesale on
a rebase re-conflict. The PRD requires a park that (FR-2) survives sweep, restart, and tick
indefinitely, (FR-1) applies to features that are not halted — including features with **no
worktree yet** — and (FR-5) leaves machine-halt semantics untouched.

## Decision

1. **Parked state is a dedicated marker file, operator-owned, machine-read-only:**
   `<repoRoot>/.daemon/parked/<slug>`. The daemon never creates, rewrites, or removes it; only
   the park/unpark verbs do. File contents: a short provenance body (timestamp + `parked by
   operator`); **presence is the signal**, contents are informational.
2. **Repo-root store, not a worktree marker.** This follows the existing per-slug operator-durable
   state pattern (`.daemon/warned/<slug>`, see `hasWarned`/`markWarned` in
   `engine/daemon-deps.ts`). Rationale over the worktree-sibling alternative
   (`.pipeline/PARKED`): a park must be placeable **before** a worktree exists (pre-emptive park
   of an undispatched spec) and must survive worktree teardown/recreate; a worktree-resident
   marker can do neither. `.daemon/` is local, gitignored state — correct for a per-checkout
   operator directive (one daemon per repo).
3. **Checked affirmatively before every autonomous decision about the slug:**
   - `rekickSweep` checks parked **first**, before `isProcessed` and the FR-9 SHA guard; parked →
     `skipped`, log `re-kick <slug>: skipped — parked by operator`, HALT and rebase state
     untouched (FR-3).
   - Discovery/dispatch eligibility (the `isHalted` call-site layer in the daemon loop) treats a
     parked slug as ineligible on every tick, startup scan, and REKICK-sentinel resume (FR-2).
   - A park placed mid-run is not consulted by the running attempt (no interruption) but is seen
     at the next decision point (FR-7, last bullet).
4. **Fail direction:** the park check must confirm **absence** to proceed. If the existence check
   errors (not plain ENOENT), the slug is treated as parked for that pass and the anomaly logged —
   an fs hiccup must never burn a run or clear a human's park (errs toward FR-2, self-heals next
   pass).
5. **Dashboard precedence:** a new **PARKED** group that outranks **every** existing group
   (HALTED, PROCESSED, GATED, IN-PROGRESS, WAITING, ELIGIBLE — including groups added by sibling
   specs); the existing groups' relative order among themselves is unchanged
   (`engine/daemon-dashboard.ts`). A slug that is both parked and halted shows once, as PARKED
   (FR-6). *(Amended at conflict-check: the original enumerated chain omitted GATED from the
   owner-gated dashboard spec — stated as "PARKED strictly first" to stay robust to sibling
   group additions.)*
6. **Canonical home:** the marker path constant + read/write/remove helpers live in one module
   (the `halt-marker.ts` single-source pattern); sweep, deps, dashboard, and CLI all import it —
   no re-spelled paths.

## Alternatives rejected

- **In-band HALT annotation (`Parked-By:` field):** clobbered by existing HALT writers; cannot
  represent parked-but-not-halted. Rejected in explore
  (`.memory/decisions/operator-park-approach.md`).
- **Worktree-sibling `.pipeline/PARKED`** (explore's initial sketch): fails FR-1's
  no-worktree-yet case and dies with worktree removal; superseded by the repo-root store at
  architecture review. The semantic decision (separate operator-owned state + verbs) is
  unchanged; only the storage location moved.
- **Daemon-process state (in-memory / supervisor):** fails FR-2 across restarts; park must not
  require a live daemon.

## Consequences

- Every future dispatch path must consult the parked check; the single canonical module plus the
  sweep/discovery chokepoints make that a one-import rule.
- Parks are per-checkout: a second clone does not see them. Acceptable today (one daemon per
  repo); a future multi-operator design (issue #184 lineage) would need an origin-visible park,
  out of scope here.
- `.daemon/parked/` joins `warned/` and `processed/` as slug-keyed local state; the known
  slug-rename dedup gap applies to parks too (a renamed slug is a different park key) —
  documented limitation, same class as the existing ledger gap.
