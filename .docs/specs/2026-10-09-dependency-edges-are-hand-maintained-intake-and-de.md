# PRD: Machine-Authored and Machine-Verified Issue Dependency Edges

**Date:** 2026-10-09
**Status:** Approved
**Source-Ref:** jstoup111/ai-conductor#536

> **Product-only.** This document states goals and requirements: the *what* and the *why*. Internal mechanisms are deferred to architecture-review under **Open Questions**.

## Problem / Background

Machinery reads the issue dependency graph in two places:
- Intake claim skips blocked issues.
- Daemon dispatch holds blocked specs in its waiting channel.

The graph's edges, however, are written by hand. Since #536 was filed, one path has become automated: dependencies declared through the structured intake field are now linked when the issue is created. Three gaps remain.

1. **Prose declarations are ignored.** An issue that says "blocked by #N" in its body gets no link unless the filer also uses the structured field. The harness already recognizes three unambiguous phrasings (`blocked by #N`, `depends on #N`, `gated on #N`), but only during a one-time historical migration. The #531 incident, where "blocking #474" sat unlinked until a manual audit, is this failure.
2. **DECIDE never proposes edges.** When a spec is landed for intake issue X, nothing turns what the authoring session learned about X's prerequisites into links. Any edge the spec implies depends on the operator remembering to add it.
3. **Nothing detects drift.** Missing links, stale links, and contradictory links stay invisible until someone audits by hand. The #226 inversion was caught only because GitHub happened to reject a cycle.

The dispatch gate can only be as correct as this graph. A missing edge lets the daemon build work before its prerequisite has shipped. A wrong edge silently reorders the roadmap. The cost grows with issue volume and with the number of operators, because today every filer must know the whole graph to file safely.

## Goals & Non-Goals

**Goals**
- A dependency declared in an issue's prose, in a recognized unambiguous phrasing, becomes a native blocked-by link without operator action.
- Landing a spec for an intake issue forces an explicit operator decision on every dependency edge the evidence implies. No implied edge is silently applied, and none is silently dropped.
- Operators can see dependency-graph drift on demand, and drift is also surfaced automatically, without the harness ever mutating the graph on its own judgement.
- Ambiguous references never create edges.

**Non-Goals**
- Changing how existing blocked-by links gate claim or dispatch.
- Re-implementing structured-field linking at filing time, which has already shipped.
- Automatically repairing drift: removing, inverting, or adding links from the report.
- Cross-repository dependency edges.
- A dashboard or visual surface for drift.

## Users / Personas

- **Operator filing or editing issues**, whether directly on GitHub or through a harness session. They want the prerequisites they write down to gate work, without a second manual linking step.
- **Operator landing a spec in a composer/engineer session.** They want to be asked about the prerequisites the spec implies at the moment they have the most context, and only then.
- **Operator maintaining the roadmap.** They want one place that lists what in the graph looks wrong, so the graph can be trusted without auditing every issue.

## Functional Requirements

### Prose declarations become links

- **FR-1:** When an issue is opened in a repository the harness services, each dependency declared in its body in a recognized phrasing (`blocked by #N`, `depends on #N`, `gated on #N`, including `/`-separated lists of issue numbers) creates a native blocked-by link from that issue to issue N. This applies whether or not the issue was filed through the structured intake form. It is limited to issues the harness is already authorized to modify under the existing GitHub operation ownership policy. For any other issue, the refusal is reported as a failed link (FR-6), and the drift report (FR-14) lists the declaration as unlinked.
- **FR-2:** When an issue's body is edited to add a recognized declaration, the corresponding link is created.
- **FR-3:** Linking is additive only. Removing or changing a declaration in the body never removes or alters an existing link.
- **FR-4:** Each of the following creates **no** edge:
  - a reference outside the recognized phrasings (for example "related to #N" or "see #N");
  - a reverse-direction reference ("blocks #N", "blocker for #N");
  - a cross-repository reference;
  - a self-reference.
- **FR-5:** Processing the same issue more than once is idempotent. A link that already exists is neither duplicated nor reported as an error.
- **FR-6:** If a declared target cannot be linked (it does not exist, it is inaccessible, or the tracker refuses the link), handling the rest of the issue still completes. The failure appears in that run's output, and no partial or wrong edge is created.

### DECIDE proposes edges at land time

- **FR-7:** When a spec is landed for an intake-sourced idea, the operator is shown every **proposed** blocked-by edge for the originating issue. Proposals come from two sources:
  - (a) dependencies the issue declares, in prose or in its structured field, that are not yet linked;
  - (b) open issues and in-flight unmerged work that the harness's existing overlap detection identifies as touching the same areas as the spec's planned changes.
- **FR-8:** Land refuses to complete while any proposal is undecided. The refusal names each undecided proposal and tells the operator how to accept or decline it.
- **FR-9:** Each accepted proposal creates its blocked-by link on the originating issue. A declined proposal creates no link. No proposal is ever applied without an explicit accept.
- **FR-10:** A proposal whose link already exists is treated as already satisfied. It is neither shown as undecided nor written again.
- **FR-11:** Landing a non-intake idea, which has no originating issue, produces no proposals and no refusal.
- **FR-12:** If proposals cannot be computed (for example, the tracker is unreachable), land does not silently proceed as though there were none. It refuses, naming the cause, unless the operator explicitly acknowledges proceeding without the dependency check. That acknowledgement is recorded.
- **FR-13:** Every land-time dependency decision is recorded on the harness's existing observability stream: the proposals shown, the ones accepted and declined, any skip acknowledgement, and any link-write failure.

### Drift is reported, never repaired

- **FR-14:** On demand, the operator can produce a drift report for a serviced repository's open issues. The report lists:
  - (a) **unlinked declarations:** recognized prose or structured declarations with no matching link;
  - (b) **stale links:** open issues blocked by an issue that was closed without being completed, meaning the prerequisite was abandoned rather than shipped;
  - (c) **contradictions:** dependency cycles, and links whose direction contradicts the issue's own prose (for example, an issue whose body says it blocks #N while the graph records it as blocked by #N).
- **FR-15:** Producing the drift report never creates, removes, or alters any link, label, or issue.
- **FR-16:** Drift detection also runs automatically during intake polling, at a bounded cadence. Each automatic run publishes one summary record to the existing observability stream, with counts per category and the affected issues. A run that finds no drift still publishes a zero-count record.
- **FR-17:** An issue whose dependency state cannot be determined (because of a tracker error or a rate limit) is reported as *indeterminate*. It is never counted as clean.
- **FR-18:** A link to a blocker that was closed as completed is normal and is not reported as drift.

## Non-Functional Requirements

- **Conservatism:** recognition is limited to the three unambiguous, forward-direction, same-repository phrasings the harness already uses for migration. A false negative, where no edge is created, is acceptable. A false positive, where a wrong edge is created, is not.
- **Reliability:** a failure in dependency linking or drift detection never prevents an issue from being filed, labeled, or polled. Only the explicit land gate (FR-8, FR-12) may block, and only land.
- **Rate-limit safety:** automatic drift detection stays within the tracker's API rate budget alongside normal polling. Its cadence is bounded, and it degrades to *indeterminate* rather than retrying in a tight loop.
- **Observability:** all automatic and land-time dependency activity is visible on the single existing observability stream. There is no parallel log or report file.

## Acceptance Criteria / Success Metrics

- Filing a test issue whose body says "blocked by #N" produces a native blocked-by link to #N, verified by reading its dependencies. Filing one that says "related to #N" produces none.
- Landing a spec for an intake issue whose body declares an unlinked dependency is refused until the operator accepts or declines it. Accepting creates the link; declining creates none.
- The drift report on a fixture repository correctly lists one example of each category (unlinked declaration, stale link, cycle, direction contradiction) and changes nothing.
- An automatic polling run publishes exactly one drift summary record.
- Every FR is covered by passing tests.

## Scope

### In Scope
- Prose-declaration linking on issue open and edit.
- Land-time edge proposals with an accept/decline gate for intake-sourced specs.
- On-demand and on-poll drift reporting, report-only.

### Out of Scope
- Structured-field linking at filing time (already shipped).
- Auto-repair of drift.
- Cross-repository edges.
- Dashboard or status-UI integration.
- Retroactive backfill of all historical issues. The existing one-time migration already covers that, and the drift report surfaces any remainder.

## Key Decisions & Rationale

- **Prose linking is automatic; land-time edges need confirmation.** Prose declarations are explicit statements by the filer in a narrow, unambiguous grammar, so applying them matches the filer's stated intent. Land-time proposals partly come from inference (overlap), so they need operator judgement.
- **Land refuses rather than merely advising.** An advisory-only land repeats the #531 failure, where a declared dependency was simply never acted on. Requiring an explicit decision costs one confirmation per proposal.
- **Drift is reported, never repaired.** Every drift category may reflect a deliberate operator choice: a link kept on purpose, or a cycle that is mid-resolution. Repair is therefore a judgement call left to the operator.
- **Stale means closed as not completed.** Closed-as-completed blockers are the normal end state that the gate already handles. Abandoned blockers silently release work whose prerequisite never shipped.

## Dependencies

- GitHub's native issue-dependency (blocked-by / blocking) API. This is a pre-existing external constraint and is the only supported edge store.
- The harness's existing recognized-dependency grammar, idempotent link writer, blocker resolution with cycle detection, and overlap detection.
- The existing GitHub workflow that already runs on issue open and edit for intake labeling.
- The existing intake polling loop and observability stream.

## Open Questions

- **Where does prose linking run?** Options are the existing issue-event automation or the harness's own polling. Event automation covers every filer at creation time; polling covers only issues assigned to the harness. Architecture-review should confirm the event path (the operator steered toward it).
- **How should land collect decisions?** It could reuse the accept/decline confirmation model already used at intake filing, or use an interactive prompt in the session. Architecture-review should weigh consistency against ergonomics.
- **How is drift cadence bounded?** Options are per poll tick, every Nth tick, or time-based, and the decision must account for the rate budget. Architecture-review should also decide whether on-demand and automatic runs share one implementation path.
- **What shape does the drift summary record take?** It must be a new variant on the existing observability stream (per the event-spine rule). Architecture-review defines its schema.
