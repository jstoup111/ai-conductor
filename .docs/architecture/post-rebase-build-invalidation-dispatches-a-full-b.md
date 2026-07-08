# Components: Post-rebase gate-first re-verify (#420)

**Last updated:** 2026-07-08
**Scope:** The rebase-invalidation path of the daemon gate loop, modified so a file-changing
finish-time rebase re-verifies the **build** gate's mechanical completion predicate before
writing its `satisfied:false` kickback verdict. Build is invalidated and re-dispatched only if
the predicate fails; a pass is confirmed in place with a fresh objective verdict + event.
`build_review` and `manual_test` stay unconditionally invalidated (their predicates do not
attest the rebased tree — see the ADR). Review-kickback rework (`kickback.from` ≠ `rebase`)
is untouched.
**Source track/complexity:** `.docs/track/post-rebase-build-invalidation-dispatches-a-full-b.md`,
`.docs/complexity/post-rebase-build-invalidation-dispatches-a-full-b.md`

## Diagram

```mermaid
graph TD
    subgraph RebaseStep["Finish-time rebase step"]
        RUN["runRebaseStep<br/>conductor.ts:2859 - UNCHANGED<br/>classifies outcome via performRebase"]
        ARV["applyRebaseVerdicts<br/>rebase.ts:725 - CHANGED<br/>on outcome changed: build pre-verify<br/>BEFORE writing its verdict; injected capability,<br/>absent capability fail-closes to today"]
        PREV["Mechanical pre-verify - NEW seam<br/>build ONLY: its predicate re-verifies the<br/>rebased history; build_review + manual_test<br/>predicates are not tree-attesting, so they<br/>stay unconditionally invalidated"]
    end

    subgraph Predicates["Mechanical completion predicates - UNCHANGED"]
        BP["build predicate<br/>artifacts.ts:589<br/>re-runs deriveCompletion every evaluation - H7"]
        DC["deriveCompletion + applyDerivedCompletion<br/>autoheal.ts:670/724<br/>git trailers over root..HEAD - survive rebase"]
    end

    subgraph LoopMachinery["Gate-loop machinery - UNCHANGED semantics"]
        GV["gate-verdicts.ts<br/>.pipeline/gates/«step».json"]
        AT["advanceTail<br/>conductor.ts:2564-2596<br/>kickback emit + navigateBack + done to pending"]
        SEL["selectNextGate<br/>selector.ts:56 - verdict authoritative"]
        LOOP["step loop dispatch<br/>conductor.ts:1086/1345<br/>no pre-dispatch completion check - stays that way"]
    end

    EV["events.jsonl<br/>NEW event: build re-verified mechanically<br/>after rebase, dispatch skipped"]

    RUN -- "outcome: changed code/test paths" --> ARV
    ARV --> PREV
    PREV --> BP
    BP --> DC
    PREV -- "build predicate FAILS: satisfied:false<br/>kickback from rebase - as today" --> GV
    PREV -- "build predicate PASSES: fresh objective<br/>verdict written, build NOT kicked back" --> EV
    ARV -- "build_review + manual_test:<br/>ALWAYS satisfied:false, unchanged" --> GV
    GV --> AT
    AT -- "resets done to pending ONLY for the<br/>actually kicked-back set - condition C1" --> SEL
    SEL -- "earliest unsatisfied gate" --> LOOP
    LOOP -- "agent dispatch only for<br/>genuinely-failing gates" --> GV
```

## Legend

- **CHANGED** — modified by this feature; **NEW seam** — the added pre-verify call path;
  **UNCHANGED** — load-bearing context.
- Pre-verify eligibility bar (ADR): a gate qualifies iff its predicate mechanically re-verifies
  the current tree/history. Today that set is exactly `{build}` (git-evidence derive).
  `build_review` (artifact-presence glob) and `manual_test` (session-freshness + FAIL scan)
  would falsely pass on same-session pre-rebase artifacts, so they stay invalidated as today.
- Fail-closed invariant preserved: a rebased tree is never trusted without re-verification —
  build's re-verification is its mechanical predicate, run first; agent dispatch happens only
  when that predicate fails (genuine pending work). A pre-verify error → invalidate.
- Oscillation guard: review kickbacks (`kickback.from` = `build_review` etc.) never pass
  through the pre-verify — a mechanical pass must not swallow requested rework.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-08 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#420 |
| 2026-07-08 | Narrowed pre-verify to build only | Architecture review: manual_test/build_review predicates are not tree-attesting (false-pass risk) |
