# ADR: Honest park termination boundary

**Date:** 2026-08-06
**Status:** APPROVED
**Deciders:** Operator (jstoup111), engineer loop for intake jstoup111/ai-conductor#1328

## Context

The daemon's feature-termination boundary in `daemon-runner.ts` decides that a feature should be
parked, writes a `.pipeline/HALT` note asserting `feature errored — parked for human inspection`,
and returns. It never writes `.daemon/parked/<slug>`. The two artifacts are produced by unrelated
code paths, and only the operator CLI (`daemon-park-cli.ts`) reaches the marker writer.

Verified forces, read from source at this spec's base:

- `daemon-runner.ts:353-362` — the `triageOutcome.kind === 'park'` branch logs the decision, calls
  `writeErrorHalt`, tears down with `keep=true`, and returns `status: 'error'`. No call reaches
  `writeAutoPark` (`park-marker.ts:231`).
- `writeErrorHalt` (`daemon-runner.ts:578`) hardcodes the "parked for human inspection" line at
  `:585` and is reached from four sites with materially different termination semantics: `:356`
  triage park (`error`), `:484` false-ship guard (`halted`, plus an escalation draft PR), `:536`
  loop ended without DONE/HALT (`error`), `:556` catch-all throw (`error`).
- `daemon-backlog.ts:846` gates dispatch eligibility on the park marker alone, via
  `isOperatorParked`. It does not consult `.pipeline/HALT`.
- `park-reconciliation.ts:479` derives its `parked` count from markers observed during the sweep,
  so `parked=0` is a downstream symptom of the absent marker rather than an independent defect.
- `writeAutoPark` is idempotent (`EEXIST` → no-op) and resolves the main repository root via
  `git rev-parse --git-common-dir`, so it is safe to call from inside a worktree.
- `runSetupTriage` is unconditionally wired on the production daemon path
  (`daemon-cli.ts:1149`, passed at `:1242`; consumed at `daemon-deps.ts:171`). Confidence 95%,
  verified by reading both construction and pass-through.

A second force, discovered during this review and load-bearing on how much the fix must carry:
`.pipeline/HALT` *should already* have suppressed re-dispatch. `writeErrorHalt` writes
`HALT.class = 'needs-human'` (`daemon-runner.ts:621`); `daemon-rekick.ts:184` skips that class
unconditionally; and `daemon.ts:155` parks any slug carrying a live HALT even for a slug the
current process never dispatched, explicitly so that a daemon restart cannot resurrect it. All are
wired in production (`daemon-cli.ts:1462`). The reported feature was nonetheless re-dispatched, so
in the observed incident the HALT was either never written or subsequently destroyed. Two
candidate mechanisms were identified and neither was confirmed (~40% each): the HALT-write
verification failure at `daemon-runner.ts:627-634` is caught and only logged, so a failed write is
indistinguishable from a successful one to every downstream reader; and `.pipeline/HALT` is
worktree-local, so any worktree recreation loses it (CLAUDE.md, Daemon Operations Safety rule 3).

This ADR does not depend on resolving that question. It is recorded because it explains why the
durable artifact, not the worktree-local one, must carry the dispatch stop.

## Options Considered

### Option A: Route the triage `park` branch through `writeAutoPark`

- **Pros:** Smallest possible change; directly closes the reported loop; no new abstraction.
- **Cons:** Repairs one of four `writeErrorHalt` call sites. The other three keep emitting a note
  that asserts a park while the feature remains dispatchable, so the false-claim class survives and
  regrows at the next termination path added to the boundary. It also leaves the decision and the
  wording as two independently maintained facts, which is the exact coupling that failed here.

### Option B: One boundary primitive owning decision, marker, and wording

- **Pros:** Callers declare park intent; the primitive performs the marker write and *derives* the
  HALT's first line from the write result. Because the note is computed from the write rather than
  written alongside it, no caller can assert a park that did not happen — the invariant is
  structural, not prose discipline. Covers all four sites at once.
- **Cons:** Touches every termination site; requires deciding the park/no-park partition explicitly
  rather than leaving it implicit.

### Option C: Make backlog eligibility honor `.pipeline/HALT`

- **Pros:** One-line change at `daemon-backlog.ts`.
- **Cons:** Makes dispatch control depend on a worktree-local artifact this repository treats as
  recreatable, so recreating a worktree silently un-suppresses the loop. Conflates halt with park,
  leaves reconciliation reporting `parked=0`, and does not satisfy the requirement that a marker
  exist on disk. Given the unresolved HALT-loss finding above, it would build the fix on precisely
  the artifact that already failed.

## Decision

Adopt **Option B**, with the park/no-park partition fixed as follows and the write failure made
loud.

**The primitive.** A single termination primitive at the `daemon-runner.ts` boundary accepts a
park intent plus a reason. When intent is park, it calls `park-marker.ts`'s existing `writeAutoPark`
and then renders the HALT note *from the result of that call*. When intent is not park, it writes
no marker and renders a note stating the feature errored and will be re-dispatched on the next
scan. The ordering — marker first, note second — is the load-bearing part of the decision: it is
what makes a lying note unrepresentable rather than merely discouraged.

**The partition.** Only site `:356` (triage outcome `park`) declares park intent. Sites `:484`,
`:536`, and `:556` declare no park intent and receive honest wording. This is required by the
stated outcome that a feature which errors but is not meant to be parked still dispatches on the
next scan. Site `:484` returns `status: 'halted'` and `daemon.ts:885` treats `halted` and `error`
identically, so no separate treatment is warranted there.

Site `:556` was examined specifically because it catches `SetupFailureError` when daemon mode has
no triage handler. That path is not reachable in production: `runSetupTriage` is unconditionally
constructed and passed on the daemon CLI path, so a daemon-mode setup failure always routes to
triage at `:344`. It therefore needs no park intent, and the "one automatic fix-session per
unresolved setup failure" outcome is satisfied entirely through `:356`.

**Write failure is loud.** The existing marker-verification failure handling at
`daemon-runner.ts:627-634` swallows its error into a log line. Under this decision a park whose
durable marker could not be written must not report itself as parked: the rendered note states
that the park failed, names the underlying error, and directs the operator to
`conduct-ts daemon park <slug>`. A park that cannot be made durable is a louder condition than an
ordinary error, not a quieter one.

**Reuse, not a parallel path.** The primitive calls `park-marker.ts` directly. It does not
introduce a second marker writer, and it does not route through `daemon-auto-park.ts`, whose #612
contradiction guard is specific to the empty/missing-plan park and would refuse or complicate a
setup-failure park for reasons that do not apply. `park-marker.ts` remains the single source of
truth for the marker, which is what keeps this fix from recreating the split-brain it removes.

## Consequences

### Positive

- A park decision and durable park state can no longer diverge: the artifact the operator reads is
  computed from the artifact the daemon obeys.
- The dispatch stop moves to `.daemon/parked/<slug>` in the main repository root, which survives
  worktree removal and recreation. This holds under every candidate explanation for the unresolved
  HALT-loss finding, including ones not yet identified.
- `park-reconciliation` begins reporting the park with no change of its own, because it counts
  markers it observes.
- The re-kick sweep already skips operator-parked slugs first and unconditionally
  (`daemon-rekick.ts:132`), so an automatic park is honored there with no new code.
- Operator recovery is unchanged: `conduct-ts daemon unpark <slug>` removes the marker, and the
  `auto-parked:` body prefix keeps automatic and operator provenance distinguishable to
  `park-reconciliation`'s classification.

### Negative

- A setup failure that would previously have resolved itself on a later dispatch (a transient
  environment problem, a since-merged fix) now requires an explicit operator unpark. This is the
  intended trade — it is the mechanism by which the token burn stops — but it converts some
  self-healing cases into operator work.
- All four termination sites change shape, so the diff is wider than the reported defect.
- Making the write failure loud introduces a third rendered note variant to keep coherent.

### Follow-up Actions

- [ ] File a separate intake for the unresolved HALT-loss mechanism — why `.pipeline/HALT` was
      absent in the reported incident despite `needs-human` classification and the restart-safe
      `isHalted` park at `daemon.ts:155`. Not blocking: this ADR's fix does not depend on it.
- [ ] Confirm during BUILD that `daemon-dashboard.ts` renders an automatically parked slug
      distinguishably from an operator-parked one, since both now occur without operator action.
