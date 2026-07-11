# Complexity: Evidence-range anchor rung — distinguish absent anchor from stale anchor

Tier: S

## Root cause (verified, file:line)

The evidence derivation has TWO call forms (`deriveCompletion`,
`src/conductor/src/engine/autoheal.ts:749`). Every PRODUCTION caller uses the
gate/engine form and omits the anchor:

- `src/conductor/src/engine/conductor.ts:1889` — `deriveCompletion(this.projectRoot, derivePlanPath)`
- `src/conductor/src/engine/artifacts.ts:718` — `deriveCompletion(ctx.projectRoot, ctx.planPath)`
- `src/conductor/src/engine/evidence-cli.ts:267,391` — passes `undefined` for the anchor

`deriveCompletion` coerces the omitted anchor to the empty string at
`autoheal.ts:762` (`const anchor = anchorArg ?? '';`) and passes `''` down to
`getEvidenceRange` at `autoheal.ts:764`.

Inside `getEvidenceRange` (`autoheal.ts:344`), the empty sentinel is fed straight
into the reachability probe at `autoheal.ts:370`
(`git rev-parse --verify '${anchor}^{commit}'` → `git rev-parse --verify '^{commit}'`),
which is an invalid revision and exits 128 (verified empirically) — NOT because a
recorded anchor is stale, but because there is no anchor at all. The failure lands
in the "unreachable" branch at `autoheal.ts:378-382`, which logs
`Evidence range: anchor ${anchor.slice(0,7)} is unreachable; falling back to
merge-base`. With `anchor === ''`, `''.slice(0,7) === ''`, producing the observed
`anchor  is unreachable` (doubled space, empty value) on 100% of gate derivations.

The empty string is a SENTINEL for "no recorded anchor," not a value that was
recorded and turned out unreachable. The code conflates absence with staleness.

## Why the producer path is correct-by-design (scope judgment)

#456 (commit `b76a3fdb`, comment at `autoheal.ts:756-761`) DELIBERATELY made the
no-anchor gate path derive the branch base (merge-base against origin default)
instead of repo genesis. Branch-base is the correct, safe evidence boundary for a
gate; the intake confirms results were correct all night on this path ("gates
behaved correctly", "no wrong verdicts observed"). The explicit anchor rung (rung 1)
is exercised only by tests today, which is a deliberate consequence of #456 — not a
missing recorder. Building a new anchor-recording feature (seed-time write + reader
wiring) would be a Tier-M enhancement that tightens the boundary but is NOT required
by the intake's desired outcome and is arguably not even desirable (branch-base is
already correct). The intake's outcome #2 treats an absent anchor as a first-class
STEADY STATE ("say so distinctly: 'no recorded anchor'"), confirming absence is
legitimate, not a bug to be recorded away.

## Why Tier S

- Single function touched: a guard branch in `getEvidenceRange`
  (`autoheal.ts` ~344-401) that checks whether the anchor is non-empty BEFORE
  running the reachability probe. Empty/blank → skip the probe, go straight to
  merge-base derivation, emit a distinct quiet "no recorded anchor" line (not a
  warn). Non-empty + unreachable → keep the existing warn verbatim.
- No new subsystem, no data model, no state machine, no new external integration,
  no CLI/hook/schema surface, no ADR-worthy architectural decision. The fallback
  merge-base logic and all derivation RESULTS are unchanged.
- Test surface is local: `src/conductor/test/engine/autoheal.test.ts` (existing
  `getEvidenceRange` describe block, lines ~715-1010) plus the empty-anchor
  passthrough test (~1676).
- ~15 lines of production change + focused test updates. Small.
