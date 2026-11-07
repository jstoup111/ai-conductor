# Conflict Check: Routed repair hosts a finding on a stack child that lacks its target file

**Date:** 2026-10-31
**Stories checked:** `.docs/stories/routed-repair-hosts-a-finding-on-a-stack-child-tha.md` (Stories 1–3) against
every story file that touches routed-repair hosting, prerequisite claims, round admission or cited-path extraction.
**Result:** Clean after resolution. 0 blocking, 0 degrading remaining; 1 degrading conflict resolved.

## Inventory

Story files compared, selected by `host`, `prerequisite`, `cited path`, `blocked-by-prerequisite`, `route record` or
`admission`: `admitted-whole-feature-fixes-in-a-stacked-feature-.md` (Story 3 residue routing, Story 4 cannot-host),
`a-routed-fix-cannot-be-built-charged-and-reviewed-.md` (prerequisite claim and reroute),
`routed-repair-opens-a-new-round-while-an-earlier-r.md` (#3445 admission fence),
`manual-reviewer-edits-cannot-be-landed-safely-in-t.md` (#3203 operator rounds, claims disabled),
`whole-feature-audit-fixes-cannot-land-in-the-stack.md`, `a-routed-fix-is-never-carried-up-the-stack-or-foll.md`,
`routed-remediation-skips-re-run-steps-on-stale-chi.md`, `routed-round-growth-halt-misreports-cap-overrun-as.md`,
`operator-command-to-inspect-and-recover-wedged-rou.md`, `stacked-repair-restack-conflict-above-the-repaired.md`, and
`surface-evidence-path-overlap-as-suggested-depende.md` (intake cited-path extraction). Other story files do not touch
routing placement or cited paths and were narrowed out.

ADRs examined: `adr-2026-10-12-routed-whole-feature-repair` as amended through #3477 and by this spec (D3, D4, D5, D6
and D7 directly relevant); `adr-2026-10-24-operator-route-round-for-closed-stacked-children`;
`adr-2026-10-07-per-child-build-region`; `adr-2026-10-23-slice-topology-from-sealed-plan`. Narrowed out:
`adr-2026-10-03-stacked-child-plans-identity-and-state`, `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`,
`adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-10-17-stacked-feature-publication-as-native-stack`,
`adr-2026-10-25-operator-recorded-restack-conflict-resolution`, `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`
and all other ADRs, which do not govern host selection, cited paths or claim verification. None of the examined ADRs is
superseded.

## Resolved: A new admission halt pre-empted the admission fence

**Stories involved:** Story 3 (first draft) vs "Round admission refuses while an earlier round still has work"
**Files:** [.docs/stories/routed-repair-hosts-a-finding-on-a-stack-child-tha.md] vs [.docs/stories/routed-repair-opens-a-new-round-while-an-earlier-r.md]
**Type:** overlap
**Severity:** degrading

**Description:** The first draft of Story 3 halted `needs-human` inside `routeAdmittedRound` when a host lacked a file its
rem blocks cite. `routeAdmittedRound` runs before `checkRoundAdmissionFence`, so with an open audit round holding a
pending host, that halt would replace the fence's required outcome: "the run ends with a `mechanical` HALT whose
first line names the open round."

**Resolution Options:**
1. Run the check after the fence, before `createRouteRecord`.
2. Keep the check inside routing and accept that it pre-empts the fence.
3. Add no halt: count block-text citations as D4 inputs, so the host moves upward instead. This works because every
   resolved input is present at the leaf.

**Resolution:** Option 3, chosen by the operator 2026-10-31 for fewer halts and more autonomy. Story 3 now asserts that
the host moves upward with no halt, and that the fence's `mechanical` HALT still wins with an open round. The track
marker, architecture diagram, architecture review and the D4 amendment note were revised in place to match.

## Pairs checked clean (both directions)

- **Story 1 vs admitted-whole-feature Story 4.** A citation with no leaf match stays an output, and an unreadable leaf
  still halts needs-human with no route record. Satisfying either story leaves the other true. Exact-path fixtures
  there resolve to themselves here. Confidence 92%.
- **Story 1 vs admitted-whole-feature Story 3 (`residue-default`).** Owner placement is unchanged; only the host moves on
  evidence. Confidence 95%.
- **Story 2 vs a-routed-fix claim story.** A claim on a file present at the host is still rejected, and a destination
  lacking a prerequisite input still rejects. The new criteria only change how paths are compared. Confidence 92%.
- **Story 2 vs #3203 operator rounds.** Claims stay disabled in operator rounds, and Story 2 is scoped to routed audit
  rounds. Confidence 95%.
- **Story 3 vs #3445 fence.** Resolved above. The fence keeps precedence. Confidence 90%.
- **Stories 1–3 vs intake overlap stories.** The intake path uses `engine/engineer/intake/cited-paths.ts`. The routing
  extractor `routing/cited-repository-paths.ts` is imported only by `conductor.ts` (verified by grep). Confidence 97%.
- **Oscillation check.** No pair names the same gate with opposite demands. Story 3 adds no stop that another story
  must clear.
