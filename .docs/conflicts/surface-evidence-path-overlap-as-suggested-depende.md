# Conflict Check: Surface evidence-path overlap as suggested dependencies at intake filing time

**Date:** 2026-09-28
**Issue:** #1606
**Stories checked:** `.docs/stories/surface-evidence-path-overlap-as-suggested-depende.md` (Stories 1–17) against every
`.docs/stories/` file plus in-flight #742 (`origin/spec/skills-may-bundle-executable-helpers`, merged companion #2788) and #2714
**ADR corpus:** `repo_wide`. All 324 `adr-*.md` were examined. 49 were read in full or in their relevant section, and 275 were
narrowed out as unrelated by subject. None was excluded as fully superseded; partly superseded ADRs were kept.
**Result:** Passed after resolution. 2 blocking conflicts were resolved and 9 degrading conflicts were resolved. None remains open.

## Blocking

## Conflict: "No dependencies" default vs non-interactive refusal

**Stories involved:** intake-only-enforcement Story 2 and Story 4 vs Story 10 (and Story 11)
**Files:** [.docs/stories/intake-only-enforcement.md] vs [.docs/stories/surface-evidence-path-overlap-as-suggested-depende.md]
**Type:** contradiction
**Severity:** blocking

**Description:** intake-only-enforcement says that omitting a dependency always records an explicit "no dependencies"
acknowledgement ("Given `--depends-on` is omitted, when filing, then linking is recorded as an explicit "no dependencies"
acknowledgement, not left undecided."). Story 10 refuses a non-interactive filing that has undecided linkable
suggestions ("no issue is created, the exit status is non-zero"). If either one is fully satisfied, the other fails.

**Resolution Options:**
1. A main-based companion PR narrows intake-only-enforcement Stories 2 and 4 in place: the "no dependencies"
   acknowledgement applies when no undecided linkable overlap suggestion exists.
2. A qualifying preamble in this feature's stories only.
3. Default undecided suggestions to declined (contradicts FR-10).

**Recommendation / Resolution (operator-selected):** Option 1. A foreign-stem story edit cannot land in this spec PR
(land stem gate), so it ships as a companion PR that merges together with the spec PR. The precedent is #2788.

## Conflict: #742 removes the `bin/intake-file` wrapper this design hands off through

**Stories involved:** #742 Story 1 and ADR decisions 5 and 7 vs architecture review D3 and the Wiring Surface row
**Files:** [origin/spec/skills-may-bundle-executable-helpers:.docs/decisions/adr-2026-09-28-skills-may-bundle-executable-helpers.md] vs [.docs/decisions/architecture-review-2026-09-28-surface-evidence-path-overlap-as-suggested-depende.md]
**Type:** sequencing
**Severity:** blocking
**ADR filename stem:** adr-2026-09-28-skills-may-bundle-executable-helpers
**Story ID:** Story 15
**ADR opposing sentence (verbatim):** "`bin/intake-file` is removed with no compatibility shim" […] "It does not `cd` into the harness"
**Story opposing sentence (verbatim):** architecture review D3: "`bin/intake-file` `cd`s into the engine directory, so the invoking directory has to be captured *before* that `cd` and handed to the CLI."

**Description:** The wiring-surface change targets a file #742 deletes. A hand-off argument would also break #742's exact
argv pass-through test.

**Resolution Options:**
1. #742 lands first (#1606 blocked_by #742), and the CLI uses its own working directory with no wrapper change.
2. #1606 lands first, using an optional env var set by the wrapper.
3. #1606 lands first with an argv flag, forcing #742 to change.

**Recommendation / Resolution (operator-selected):** Option 1. The blocked_by link is recorded, and the architecture review
D3, the Wiring Surface section and the diagram carry amendment notes. Story 15 is phrased as behavior and survives unchanged.

## Degrading (all resolved)

- **Engine-internal filers vs Story 10.** `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D5 says: "files each `unfiled`
  record through `fileIntakeIssue` with `interactive: false` […] Filing never blocks a lap." The build_review deferral
  executor has the same shape. Type: overlap. Resolution: a scope note in the stories, a Story 10 negative criterion that
  engine-internal filings get no check and are never refused, and amendment notes on the PRD and architecture review D6.
- **Squash-merged daemon branches look unmerged.** `adr-2026-08-01-multi-proof-park-deletion-authority`: "under squash-merge
  `git merge-base --is-ancestor <branch> origin/main` returns 1 **by construction**, forever". This is set against Story 3,
  "A merged branch in the fixture is never reported". Type: state-conflict. Resolution: the filing preflight excludes a branch
  whose shipped record exists on the base ref. Story 3 gains a negative criterion, and D2 gains an amendment note.
- **Event record location after #742.** Story 16 wording is now "the filer's existing event record", and the no-new-file
  check is scoped to the check's own writes.
- **DECIDE-scan TR-1 "or open-PR branch" vs Story 17.** Story 17 now pins the branch set to exactly today's `spec/*` set.
- **#2714 may redefine link-failure reporting.** Story 12 now says "reported exactly as it is for the same dependency named
  up front" and no longer pins the warning text or exit code.
- **`adr-2026-07-23-intake-label-authority-scoped-replace` Decision 2 (body headings) vs Story 12's exact-body check.** Story 12
  now compares against "the body the pre-change filer submits for the same input".
- **Invalid decline is fatal, invalid dependency ref only warns.** Story 13 keeps the fatal rule and gains a rationale
  paragraph so the asymmetry is not "harmonized" away.
- **Story 1 internal: happy path vs existence filter.** The happy path now states that no target checkout is available.
- **Story 4 marker wording.** It now names the branch's own `.docs/intake/«slug».md`.

## ADR-mandated mechanisms (recorded as architecture-review amendments, no conflict)

- Marker read-back reuses `artifacts.ts` (`adr-2026-07-22-canonical-tagged-source-ref`).
- The new event variant declares an `EVENT_SINKS` row (`adr-2026-07-26-event-sink-registry-exhaustiveness`).
- Open-issue bodies: only the exact path intersection is ever output (`adr-2026-09-06-inbound-intake-trust-boundary` D1).
- The registry read honors `AI_CONDUCTOR_REGISTRY` (`adr-2026-07-22-examples-state-isolation`).

## Examined ADRs with subject overlap and no conflict

`adr-2026-07-21-intake-only-enforcement` (A1, operator-confirmed); `adr-2026-07-21-decide-time-unmerged-overlap-scan`;
`adr-2026-07-22-coherence-waiver-and-duplicate-claim`; `adr-2026-07-22-canonical-tracker-client-seam`;
`adr-2026-09-11-github-operation-ownership`; `adr-2026-07-03-issue-dependencies-api-surface`;
`adr-2026-07-03-prose-to-link-migration`; `adr-2026-07-22-canonical-tagged-source-ref`;
`adr-2026-09-06-inbound-intake-trust-boundary`; `adr-003`; `adr-010`; `adr-008`;
`adr-2026-06-30-engineer-worktree-authoring-isolation`; `adr-2026-07-26-event-sink-registry-exhaustiveness`;
`adr-2026-08-11-halt-events-ride-the-persisted-spine`; `adr-2026-08-09-hook-owned-containment-event-ledger`;
`adr-2026-08-08-pipeline-owned-closeout-timestamps`; `adr-014`; `adr-2026-07-03-dependency-fail-closed-and-cache`;
`adr-2026-06-30-owner-gate-identity-resolution`; `adr-2026-08-17-structural-live-checkout-containment`;
`adr-2026-09-23-engine-git-guard-on-agent-path`; `adr-2026-09-05-gh-cli-version-floor-and-environment-gate`;
`adr-2026-07-08-main-checkout-leak-triage`; `adr-2026-07-27-ancestry-proven-park-reconciliation`;
`adr-2026-07-29-defer-feature-worktree-reap…`; `adr-2026-06-30-owner-provenance-recording`;
`adr-2026-07-21-owner-stamped-at-authoring`; `adr-009`; `adr-011`; `adr-012`; `adr-2026-06-30-background-intake-brain-loop`;
`adr-2026-07-22-intake-closed-issue-reconciliation`; `adr-2026-07-04-claim-time-delivery-evidence-guard`;
`adr-2026-07-10-intake-claim-priority-banding`; `adr-2026-07-03-dependency-gate-backlog-waiting-channel`;
`adr-2026-08-29-build-review-remediate-case-adjudication`; `adr-2026-08-27-daemon-dispatcher-executor-seam`;
`adr-2026-08-09-operator-only-scoped-artifact-reseal`; `adr-2026-07-25-first-class-codex-skill…`;
`adr-2026-07-22-examples-state-isolation`; `adr-2026-07-06-installed-root-resolution…`;
`adr-2026-06-30-self-host-detection-seam`; `adr-2026-07-25-fail-closed-durable-shipment-evidence`.

## Clean story pairs (examined both directions)

`scan-overlap-against-each-branch-s-own-merge-base-` S1/S2 vs Story 3. `spec-authoring-is-blind-to-unmerged-dependent-work`
TR-4 and TR-5 vs Stories 1, 10 and 14. intake-only-enforcement S2 (TTY size/priority prompts; label failure exits 0) and S6
(no downstream gate) vs Stories 8, 9 and 12. `dependency-ordered-intake-and-dispatch` vs accepted links.
`intake-issue-pr-link-autoclose` S1/S3 and `generalize-source-ref-parsing` vs Story 4. `intake-convention` vs Story 12.
`github-issue-text-reaches-an-autonomous-build`, `canonical-tracker-client-seam`, `phase-9.2-registry-project-creation`, the
halt-monitor stories, and #742 Story 1 (exit-status pass-through) vs Stories 9, 10, 13 and 15.

## Landing order

#2714, then #742, then #1606. The intake-only-enforcement companion story PR merges together with this spec PR.
