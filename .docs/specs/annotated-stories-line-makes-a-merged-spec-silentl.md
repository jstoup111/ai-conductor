# PRD: An Unbuildable Merged Spec Is Blocking and Visible, Never Silently Skipped

**Date:** 2026-08-05
**Status:** Approved
**Issue:** jstoup111/ai-conductor#1330

## Problem / Background

A merged, accepted spec can be permanently undispatchable with no log line, no warning, and
no dashboard row.

The reported trigger is a plan whose `**Stories:**` line names a valid path followed by a
human annotation:

    **Stories:** `.docs/stories/speed-up-test-suite.md` (TR-1..TR-6)
    **Stories:** .docs/stories/v4-latest-endpoint.md (11 stories)

`resolvePlanStoriesPath` captures the entire remainder of the line and then fails the
`.md` extension check, returning `null`. `discoverBacklog` turns that `null` into a bare
`continue` — unlike every neighbouring skip, which calls `warnOnce` with an operator-facing
reason. In `reporting_app` three of four plans were affected, leaving the daemon exactly one
dispatchable spec while the dashboard reported `PARKED (0) / HALTED (0) / GATED (0) /
ELIGIBLE (0)`. Diagnosis took about two hours and only concluded by reading engine source and
re-running the resolver by hand.

Measured on this repository's default branch during DECIDE, the annotated form is not an edge
case: **82 of 253 plans** carry a reference the current resolver refuses. The annotation is a
natural thing to write, and both `/plan` output and hand-authored plans produce it.

The parsing bug is the trigger; the silence is the defect. The same silent-`continue` shape
means any future content-vetting miss disappears the same way, and the four existing
`merged spec cannot build — …` skips are visible only to whoever reads the log file. The
operator's directive at DECIDE was explicit: **skipping a merged spec is not an acceptable
pattern — it must block and be visible.**

`HALTED` is not the right home for it. HALTED is derived from per-worktree `.pipeline/HALT`
markers and drives `halt-pr-rehabilitation`, `build-failure-escalation`,
`episode-halt-tracker`, `daemon-rekick`, and `park-reconciliation`. An unbuildable merged
spec has no worktree, no attempt, and no PR, and its remedy is a fix on the default branch —
not "clear the HALT and re-kick". A distinct state carries the correct remedy and leaves that
automation untouched.

## Goals & Non-Goals

**Goals**

- A plan whose `**Stories:**` line names a valid path followed by trailing prose resolves to
  that path, and the spec dispatches.
- No merged spec is ever excluded from the backlog without an operator-visible reason.
- An operator can determine, from `conduct-ts daemon status` alone, why a merged and accepted
  spec is not in `ELIGIBLE`.
- A genuinely unresolvable stories reference is still refused — and now says so out loud.
- A newly authored spec cannot reach the default branch carrying an unusable stories
  reference, and the refusal names the accepted forms.

**Non-Goals**

- Changing which specs are *eligible* beyond the newly-resolvable annotated form. No content
  vetting rule is relaxed, added, or reordered in its verdict.
- Auto-repairing plans on the default branch, or writing to the repository from discovery.
- Retroactively surfacing already-processed or already-shipped legacy plans (82 of them here)
  as blocked work.
- Extending `HALTED`, park, or the ownership gate, or changing their automation.
- **Rendering blocked specs in the daemon startup dashboard.** The dashboard is already past
  its readable limit at this repository's scale (102 lines, rows up to 328 characters, 85 of
  102 rows inert), so adding a ninth group to it would make the display worse, not better.
  Blocked specs reach the operator through `conduct-ts daemon status`, which is where the
  reported triage actually happened. The dashboard's redesign — including how it should
  present blocked work — is deferred to
  [#1332](https://github.com/jstoup111/ai-conductor/issues/1332).
- GitHub write-back (PR or issue comments) for blocked specs.
- Supporting stories references outside the repository, above the repository root, or with a
  non-Markdown target.

## Users / Personas

- **The daemon operator** (solo dev, frequently checking from a phone): needs `daemon status`
  alone to explain an idle daemon, and needs the one action that unblocks each spec.
- **The spec author** (the `/engineer` loop, or a human writing a plan by hand): needs to be
  told at land time, in terms of the accepted forms, when a stories reference is unusable.

## Functional Requirements

### Reference resolution

- **FR-1:** `resolvePlanStoriesPath` resolves a `**Stories:**` line whose reference is a valid
  repo-relative Markdown path followed by trailing prose, to that path — for a bare path, an
  inline-code path, and a Markdown link alike.
- **FR-2:** Resolution of the three previously-supported shapes (bare path, inline-code path,
  Markdown link, each with no trailing text) is unchanged.
- **FR-3:** A reference that is absolute (POSIX or Windows), escapes the repository root, or
  whose resolved target is not a `.md` file is still refused, as is a line with no usable
  reference at all.
- **FR-4:** A plan with no `**Stories:**` line still falls back to the same-stem stories path.

### Blocking, not skipping

- **FR-5:** Discovery classifies every merged spec it declines to make eligible for a
  content reason as **blocked**, emitting a structured entry carrying the slug, a machine
  reason, and an operator-actionable remedy — never a bare `continue`.
- **FR-6:** The blocked reasons distinguish at minimum: the plan's stories reference does not
  resolve; it resolves but the target is absent on the default branch; stories are not
  approved; the plan carries no dependency tree; and the coherence artifact required for the
  spec's tier is missing or unparseable.
- **FR-7:** A spec that is already processed, already shipped (by stem or by content), or
  operator-parked is never reported as blocked.
- **FR-8:** Blocked classification is visibility-only: the set of eligible specs produced by
  a discovery pass is unchanged except for plans made newly resolvable by FR-1.
- **FR-9:** The existing `merged spec cannot build — …` log lines are retained unchanged, and
  the two newly-classified stories reasons gain log lines at the same visibility and under
  the same warn-once dedup.

### Operator visibility

- **FR-10:** Each discovery pass writes the full blocked result to a per-repo snapshot,
  replacing the previous contents, so an entry that stops being blocked disappears without
  operator cleanup.
- **FR-11:** `conduct-ts daemon status` reads that snapshot and renders a per-repo blocked
  section with each slug's reason and remedy.
- **FR-12:** `daemon status` labels the snapshot's freshness, and reports an explicit unknown
  state when the snapshot is missing or unparseable, rather than implying zero blocked specs.
- **FR-13:** `daemon status` performs no repository scan, git operation, or network call to
  render the blocked section.

### Authoring-side refusal

- **FR-14:** `landSpec` continues to refuse a plan whose stories reference does not resolve to
  the selected stories artifact, and its error names the accepted reference forms — including
  that a trailing annotation is permitted.
- **FR-15:** The `/plan` skill documents the accepted `**Stories:**` reference forms.

## Non-Functional Requirements

- **NFR-1:** `daemon status` stays cheap and offline (FR-13) — it remains a phone-speed check.
- **NFR-2:** Discovery adds no repository writes beyond the blocked snapshot and the existing
  warn-once markers.
- **NFR-3:** A malformed or unreadable blocked snapshot never fails a `daemon status` run.

## Acceptance Signals

- A plan carrying `` **Stories:** `.docs/stories/x.md` (11 stories) `` on the default branch,
  with approved stories and a dependency tree, appears in `ELIGIBLE` and dispatches.
- A plan whose stories reference cannot resolve is reported by `daemon status` as blocked,
  with that reason and a remedy, and never appears in `ELIGIBLE`.
- `daemon status` on a repo whose daemon has never run reports blocked state as unknown, not
  as zero.
- A repository whose plans are all processed or shipped reports zero blocked specs.
