# ADR: prd_audit's pass signal is a coverage-complete manifest

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** jstoup111 (operator), engineer (DECIDE)

## Context

`prd_audit` is the SHIP gate that checks the shipped implementation against the approved PRD's
functional requirements. Its completion predicate scores the audit by scanning
`.pipeline/prd-audit.md` for **blocking rows that are present**
(`src/conductor/src/engine/artifacts.ts:2300`):

    for (const f of fresh) {
      const blocking = findUnalignedFrRows(await readFile(f, 'utf-8'));
      if (blocking.length > 0) { ... return { done: false, ... }; }
    }
    ...
    await writePrdAuditCodeStamp(dir, ctx);
    return { done: true, verdictFreshness };

Nothing checks that every FR has a row at all. An FR that was never audited contributes no row,
so it cannot contribute a *blocking* row, so the gate passes. `writePrdAuditCodeStamp` then
persists that pass, and the `#817` preserve path can reuse it on later runs.

This is reachable in practice. The per-FR fan-out is prose in `skills/prd-audit/SKILL.md` §3,
invisible to the engine — `grep -rn "prd-auditor" src/` returns nothing, and the engine sends one
skill invocation with no arguments (`skill-invocation.ts:40`). Operator-reported: the step's main
agent dispatched the per-FR auditors as background tasks and ended its turn with two still in
flight; `claude -p` terminates at turn end, Claude Code drains background tasks for 600s and kills
the survivors, **and the process exits 0**. The engine records a success and the SHIP tail advances.

The same fail-open shape reads clean at **four** independent sites, all of which ask only the
blocking-rows question:

| Site | Role | Effect of a partial report |
|---|---|---|
| `artifacts.ts:681` (`sweptArtifactStillValid`) | spares stale run evidence from deletion | keeps a partial report alive as if authoritative |
| `artifacts.ts:2257` | `#817` preserve pre-check | preserves the false pass |
| `artifacts.ts:2300` | main completion path | returns `done: true` |
| `artifacts.ts:3267` (`classifyPrdAuditGaps`) | daemon BUILD-vs-HALT routing | classifies `clean` |

The sibling gate was already hardened against precisely this class: the comment immediately below
the `prd_audit` predicate records making `architecture_review_as_built` fail-closed because a
garbled verdict previously "slip[ped] through marked `done`". `prd_audit` never received the
same treatment.

Constraints in play:

- **FR ids are only mostly enumerable.** 43 of 48 non-`SUPERSEDED-` files in `.docs/specs/`
  contain literal `FR-N` ids (measured 2026-08-09). `skills/prd-audit/SKILL.md` §1 further permits
  a PRD to use a different label, with the auditing agent numbering requirements "FR-1, FR-2, … in
  document order" — an ordering the engine cannot reproduce.
- **No dynamic invocation arguments.** `renderSkillInvocation` (`skill-invocation.ts:56-66`) joins
  a static `arguments` array from the descriptor table, so the engine cannot today tell the skill
  *which* FRs to re-audit without new plumbing.
- **The engine cannot observe the fan-out.** Bounding per-FR dispatch lifetime requires the engine
  to own dispatch, which is out of scope here and tracked by #1398.

## Options Considered

### Option A: PRD-derived coverage gate only
Enumerate `FR-N` ids from the approved specs; require a verdict row per FR at all four sites.

- **Pros:** fully deterministic; owes nothing to agent honesty; smallest diff; catches under-fill
  from any cause.
- **Cons:** detection rather than construction. Where the engine cannot enumerate the roster — the
  5 specs with no `FR-N` ids, and any PRD relying on the skill's implicit document-order numbering
  — the gate silently retains today's fail-open behavior. Those are the specs least likely to be
  well-formed, so the hole sits exactly where the risk is highest.

### Option B: Structured coverage-complete manifest as the pass signal
The skill writes `.pipeline/prd-audit.json` carrying the FR roster it audited and a verdict per
roster entry. The gate passes only when the manifest exists, parses, has a non-empty roster, and
every roster entry carries a verdict. `.pipeline/prd-audit.md` remains the human-readable view.

- **Pros:** fail-closed **by construction** — an absent, truncated, or unparseable manifest cannot
  pass, so the gate degrades safely under any failure including ones not yet imagined. No markdown
  parsing in the trust path. Works on the non-enumerable specs. Carries the exact missing-FR set
  needed for partial resume. Matches repo idiom (`.pipeline/build-review.json`,
  `.pipeline/remediation.json`, both already JSON gate evidence).
- **Cons:** largest of the three; four read sites plus `classifyPrdAuditGaps` must migrate to a
  shared predicate; an in-flight feature holding only the old markdown report must re-audit.
  On its own, a roster the agent under-declares still passes.

### Option C: Roster line in the markdown report
Require `**FRs audited:** FR-1, FR-2, …` in the report; check every listed FR has a row.

- **Pros:** smallest diff; no new artifact; no PRD parser.
- **Cons:** keeps agent-authored markdown as the trust boundary; an under-declared roster passes;
  buys little over B while giving up B's structural guarantee.

## Decision

**Adopt Option B, with Option A layered on as a cross-check wherever FR ids are enumerable.**

B is chosen over A because B is fail-closed by *construction* while A is fail-closed only by
*detection*. A can only catch an under-filled report when the engine can independently derive the
roster, and the cases where it cannot are not rare edge cases — they are 5 of 48 current specs plus
every PRD that leans on the skill's implicit numbering. A gate whose safety property evaporates on
malformed input is the wrong shape for a gate whose entire purpose is catching malformed output.

A is retained rather than discarded because B alone rests on the agent's declared roster being the
real FR set. Where the engine *can* enumerate `FR-N` ids, it cross-checks the roster against them
and blocks a roster that understates the PRD. The two layers fail independently: B catches an audit
that stopped early, A catches an audit that never intended to cover everything.

C is rejected outright — it shares B's dependence on agent honesty while keeping A's brittle
markdown parsing, and is dominated by both.

Three subordinate decisions follow from this:

1. **One shared completeness predicate, consumed by all four sites.** The sites differ in what they
   do with the answer (spare, preserve, pass, classify) but must not differ on what "complete"
   means. A site left asking only the blocking-rows question keeps the fail-open path alive, so
   the predicate is written once and called four times rather than reimplemented per site.

2. **An incomplete audit re-dispatches `prd_audit`; it never routes to BUILD.** Today any
   unsatisfied `prd_audit` gate builds a remediation work order toward BUILD
   (`conductor.ts:4884-4940`). "The audit did not finish" is not a gap BUILD can close, and
   routing it there makes the daemon churn on work that cannot help. Incompleteness is therefore
   classified distinctly from a gap verdict and returns to `prd_audit` itself. Because a lone
   re-dispatched member hits the width-1 degrade to the serial path (`conductor.ts:4160`), it
   receives 3 attempts and the escalation ladder rather than the validation branch's single
   attempt — so a straggler self-heals without operator involvement.

   > **Amended 2026-08-09 by #1398:** when an audit is *both* incomplete and carries a blocking
   > verdict — reachable whenever an audit is killed after recording at least one gap —
   > **incompleteness takes precedence** and the step re-dispatches `prd_audit`. The blocking
   > verdicts already recorded are preserved (decision 3) and re-evaluated once coverage is
   > complete. Rationale: a gap picture drawn from a partial audit is not trustworthy enough to
   > route on, and dispatching BUILD against it risks fixing the wrong thing while unaudited FRs
   > remain unknown. The cost is one extra audit cycle before a genuine gap reaches BUILD, bounded
   > by the serial retry budget. Raised as blocking Conflict 2 in
   > `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`, where the original
   > decision left the precedence undefined.

3. **Partial resume rides the existing `#817` code stamp; no new invalidation machinery.**
   `sweptArtifactStillValid` (`artifacts.ts:681`) already asks `gateVerdictStillValid` whether the
   gate's `feature-runtime` surface has moved. That single existing answer supplies both required
   behaviors: **preserve** spares the partial manifest so only FRs lacking a verdict are re-audited;
   **invalidate** deletes it so every FR is re-audited. The skill reads its own missing set from the
   surviving manifest, which avoids the dynamic-invocation-argument plumbing that
   `renderSkillInvocation` does not support, while the engine still verifies coverage
   deterministically afterward. Prose decides *which* FRs to redo; machinery decides whether the
   result is acceptable.

   > **Amended 2026-08-09 by #1398:** this decision named `sweptArtifactStillValid` as the resume
   > seam without accounting for the fact that its single boolean return is *also* the validity
   > signal other callers consume. Asking one boolean to mean both "keep this file on disk" and
   > "this is a finished verdict I can trust" is unsatisfiable: sparing a partial manifest for
   > resume necessarily reports an incomplete audit as valid, and reporting it invalid necessarily
   > deletes the resume input. Raised as blocking Conflict 1 (oscillating) in
   > `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`.
   >
   > The sweep outcome is therefore **three-valued**, and validity remains a separate question:
   >
   > | Outcome | Precondition | Meaning |
   > |---|---|---|
   > | `spare-as-valid` | manifest complete, no blocking verdict, code stamp validates | a finished verdict; may satisfy the gate without re-dispatch |
   > | `spare-for-resume` | manifest incomplete, code stamp validates | retained **solely** as resume input; never reported as a verdict, never satisfies the gate |
   > | `delete` | anything else, including a missing code stamp | full re-audit |
   >
   > The completeness question of decision 1 is unchanged and is still asked independently at all
   > four sites; `spare-for-resume` grants no exemption from it.

### Event spine

Checked per `.agents/skills/event-spine/SKILL.md` before this design was written:

```
Channel?    no  — the manifest is gate evidence, read by name
Concern:    durable state ("what is true now"), not an occurrence in time
Verdict:    ordinary gate artifact; exception C. No new channel, no ADR debt.
            Precedent: .pipeline/build-review.json, .pipeline/remediation.json

Channel?    yes — "N FR audits dispatched, M returned" IS an occurrence
Verdict:    would require extending the ConductorEvent union, never a sidecar counter.
            OUT OF SCOPE: the engine does not dispatch per-FR in this change, so it
            cannot honestly emit those events. Deferred to #1398.
```

No timestamp, counter, or status is stamped into an existing artifact to stand in for an event.

## Consequences

### Positive
- An audit that did not cover every FR can no longer be recorded as a pass, nor preserved or
  reused as one by a later run.
- The failure mode changes from a silent false ship to a loud, correctly-routed re-audit that
  self-heals in the daemon.
- The gate's trust path stops depending on markdown table parsing.
- Partial audit work survives a re-dispatch when the implementation has not moved, so a straggler
  costs only the missing FRs rather than a full re-audit.

### Negative
- **The straggler itself is not fixed.** Auditors can still be killed at turn end, the 600s drain
  still elapses, and the frontier-workers / lightweight-aggregator model split is still
  unexpressible — the engine passes exactly one `--model` per step
  (`claude-provider.ts:740`). All three require engine-owned dispatch and are tracked by #1398.
  This ADR deliberately buys correctness, not efficiency.
- **A one-time re-audit for in-flight features.** A feature holding a fresh markdown report but no
  manifest will block and re-audit once. This is the correct fail-closed behavior — a report whose
  completeness cannot be established should not pass — but it is a real cost at rollout.
- **The skill gains an obligation.** `skills/prd-audit/SKILL.md` must write the manifest, and a
  skill that does not is now hard-blocked instead of silently passing. That is the intent, and it
  is enforced by machinery rather than by prose.
- **`artifacts.ts` is a contended file.** An advisory `overlap-scan` on 2026-08-09 reported 29
  unmerged spec branches touching it, so this work should expect a rebase.

### Follow-up Actions
- [ ] Register `.pipeline/prd-audit.json` in `ARTIFACT_PATTERNS` (`artifacts.ts:284`) with `run`
      scope, alongside the existing markdown pattern, so the sweep treats them as one unit.
- [ ] Extract one completeness predicate and call it from all four sites.
- [ ] Classify incompleteness distinctly from a gap verdict in the `prd_audit` kickback routing.
- [ ] Update `skills/prd-audit/SKILL.md` §3/§4 to write the manifest and to fill only FRs lacking
      a verdict when a manifest survives.
- [ ] Confirm no regression to `#655`'s delta-aware rebase preservation of `prd_audit`.
