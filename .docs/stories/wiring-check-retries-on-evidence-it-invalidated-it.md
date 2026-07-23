**Status:** Accepted

# wiring_check: stale evidence is re-derived, not re-dispatched (#897)

Track: technical (no PRD — acceptance criteria live here)
Tier: S

## Context

The `wiring_check` completion predicate rejects `.pipeline/wiring-evidence.json` whenever the
`head` recorded in the evidence differs from the current HEAD
(`src/conductor/src/engine/artifacts.ts`, `validateWiringEvidence`). The gate's own remediation
loop invalidates that key as a matter of course: the dispatched session analyses, writes evidence,
then **commits its wiring fix**, advancing HEAD past the sha the evidence was stamped with. The
step then retries with a contentless reason ("…is stale — re-run wiring-reachability analysis at
the current HEAD") and the *next* LLM dispatch re-materialises the same verdict at the new HEAD
and passes.

Live evidence (`.daemon/daemon.log` + `.daemon/daemon.log.1`, two days): **22** stale-evidence
retries; every instance traceable to an outcome (**19 of 19**) passed on the immediately following
attempt, 30 s to 10 min later, each costing a full agent re-dispatch. Zero defects were caught by
this class. At least one occurrence (2026-07-23T16:21:43Z) burned the last retry and made the
whole step terminal-fail on staleness alone. Over the same window the gate's *genuine* findings
(orphan exports, undeclared surface) produced 13 retries across 8 signatures with 2 terminal
failures — real defects whose retry budget the false class is eating.

The verdict is not a property of a commit sha. It is a property of **the analysed range**
(`base...HEAD` content) evaluated against the plan's `Wired-into:` contracts — and that range is
already re-derivable deterministically in-process: `CompletionContext.wiringProbe` is wired
unconditionally by the real `Conductor` and is *already* used by this same predicate to compute
evidence from scratch when no evidence file exists. Re-deriving is therefore strictly cheaper than
the dispatch it currently pays for.

**What changes, precisely.** The *acceptance condition* is unchanged and stays strict: evidence is
trusted only when its recorded `head` equals the current HEAD — a conservative proxy for "computed
over the range now under review", never relaxed. What changes is the **remedy on mismatch**: today
a mismatch rejects and re-dispatches an LLM session to re-materialise the verdict; after this
change a mismatch discards the evidence and re-derives the verdict deterministically in-process at
the current HEAD. Stale evidence is therefore *never trusted* in either design — the fix removes a
wasted dispatch, it does not widen what counts as fresh, and it is not an unconditional accept.

Out of scope (explicitly rejected upstream, not re-litigated here): converting `wiring_check` to
an engine-native no-dispatch step (PR #891, issue #879), and reordering it relative to
`build_review`. The LLM dispatch that remediates reachability gaps is retained unchanged.

---

## Story 1 — Evidence invalidated only by the gate's own fix commit is re-derived, not retried

**Requirement:** #897 desired outcome 1 & 3

As the SHIP-phase gate loop, when the wiring session writes evidence and then commits its fix, I
want the gate to re-derive the wiring verdict at the current range in-process, so a verdict that
was computed for the work under review is not discarded merely because HEAD advanced, and the
retry budget is spent on real reachability findings.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/wiring-evidence.json` recorded at head `H1` with no gaps, and a wiring fix has
  since been committed so HEAD is `H2` (`H2 != H1`), and the live probe is available, when the
  `wiring_check` completion check runs, then the recorded evidence is discarded, a fresh verdict
  is derived at `H2`, and the step completes **`done`** with **no** `stale` retry reason emitted
  and **no** additional agent dispatch.
- Given the same conditions, when the fresh verdict is derived, then it is durably written to
  `.pipeline/wiring-evidence.json` recording `head = H2`, so the audit trail and the conductor's
  kickback reader both see the verdict actually used.
- Given `.pipeline/wiring-evidence.json` whose recorded `head` already equals the current HEAD and
  which carries no gaps, when the check runs, then it completes `done` **without** invoking the
  probe (pre-existing fast path preserved, no redundant recompute).

#### Negative Paths
- Given stale evidence at `H1` and current HEAD `H2`, when the re-derived verdict at `H2` contains
  reachability gaps, then the step does **not** complete: it fails with the verbatim gap messages
  (not with a staleness reason), so the conductor kicks back to `build` with actionable text
  instead of a contentless "re-run the analysis" retry.
- Given stale evidence and a probe that throws, when the check runs, then the step fails closed
  with a `wiring probe failed: <message>` reason — never `done`, and never silently accepting the
  stale verdict.

### Done When
- [ ] A test drives evidence stamped at a prior HEAD plus an injected probe returning a gap-free
      verdict at the current HEAD, and asserts `checkStepCompletion('wiring_check', …)` returns
      `{ done: true }` with no reason containing `stale`.
- [ ] The same test asserts the on-disk `.pipeline/wiring-evidence.json` after the check records
      the **current** HEAD, not the prior one.
- [ ] A test asserts that when the recorded key already matches the current range, the injected
      probe is **not** called (call-count assertion).
- [ ] A test asserts a gap-carrying re-derived verdict yields `done: false` whose reason contains
      the gap message text and does **not** contain `stale`.
- [ ] A test asserts a throwing probe yields `done: false` with a reason matching
      `/wiring probe failed/`.

---

## Story 2 — Genuinely stale evidence is still never trusted

**Requirement:** #897 desired outcome 2 & negative path

As the wiring-reachability gate, when the evidence on disk was computed for a materially different
range — a leftover from an earlier, unrelated build — I want it to be discarded and recomputed
rather than honoured, so the fix does not degenerate into an unconditional accept that blinds a
gate which does catch real defects.

### Acceptance Criteria

#### Happy Path
- Given leftover evidence from an unrelated earlier build recording head `H0` with a clean,
  gap-free verdict, and the current HEAD is `H1` (`H1 != H0`), when the check runs, then the
  leftover verdict is **never** used as the gate's answer — the outcome is decided solely by a
  verdict derived at the current HEAD.
- Given that leftover evidence and a current range whose code contains a genuine orphan export,
  when the check runs, then the step fails with that orphan's gap message — i.e. the leftover
  clean verdict does not mask a live defect.

#### Negative Paths
- Given leftover evidence whose `tasks` array carries entries from an unrelated build, when the
  verdict is re-derived, then the on-disk evidence is **replaced wholesale** by the fresh result —
  no task, gap, waiver, or `layer2` field from the discarded evidence survives into the file or
  into the reason text (no merge, no partial carry-forward).
- Given evidence that is malformed, non-JSON, or fails schema validation, when the check runs,
  then the pre-existing fail-closed rejection is unchanged (`invalid JSON in …` / the schema
  reason) — recompute-on-stale must not become a repair path for corrupt artifacts.

### Done When
- [ ] A test asserts a clean leftover verdict recorded at an unrelated `(base, head)` never yields
      `done: true` on its own — the result tracks the re-derived verdict, including failing when
      the re-derived verdict has gaps.
- [ ] A test asserts the re-derived evidence wholly replaces the previous file contents (no
      leftover `tasks`/`waivers`/`layer2` entries from the discarded verdict).
- [ ] A test asserts malformed / schema-invalid evidence still fails with its existing reason and
      does not trigger a repair-by-recompute.

---

## Story 3 — Fail-closed behaviour is preserved where no probe can run

**Requirement:** #897 desired outcome 2 (must not become an unconditional accept)

As a caller of the completion predicate that has no live probe wired (raw unit/acceptance calls,
fixture-driven checks), I want the pre-existing stale-rejection behaviour to be exactly preserved,
so the change is additive and no existing guarantee is relaxed.

### Acceptance Criteria

#### Happy Path
- Given evidence recorded at a prior HEAD and a completion context with **no** probe injected,
  when the check runs, then the step fails with the existing `…is stale — evidence recorded for
  <H1> but HEAD is <H2>…` reason, byte-identical to today.
- Given a completion context whose HEAD is indeterminate (`getHeadSha` absent, or resolving to
  `null` because the project root is not a git checkout), when the check runs, then the freshness
  comparison is skipped exactly as it is today and no probe is invoked for freshness purposes.

#### Negative Paths
- Given a stale-evidence file and a probe that returns a verdict still stamped at a range other
  than the current one (HEAD moved again while the probe ran), when the check runs, then the step
  fails with a staleness reason rather than looping — re-derivation is attempted **at most once**
  per completion check.

### Done When
- [ ] The existing regression test "rejects evidence recorded at a prior HEAD, even though that
      evidence is a clean PASS" (`test/engine/artifacts.test.ts`) passes unmodified.
- [ ] A test asserts an indeterminate HEAD invokes no probe and does not fail on freshness.
- [ ] A test asserts a probe whose returned verdict is itself off-range produces a single
      staleness failure and exactly one probe invocation (no recursion / no retry loop in-process).
