# PRD: Surface evidence-path overlap as suggested dependencies at intake filing time

**Date:** 2026-09-28
**Status:** Approved
**Tier:** M
**Source:** jstoup111/ai-conductor#1606

> **Product-only.** State goals and requirements (the *what* and *why*). Do NOT name the *new
> internal mechanism* for this feature — commands/flags, file paths, config keys, function/class/type
> names, library/protocol/mechanism choices, schemas, ports. Name capabilities/behaviors instead, and
> put any load-bearing technical choice under **Open Questions** for architecture-review. Pre-existing
> *external* constraints/dependencies may be named under Dependencies / Non-Functional Requirements.

## Problem / Background

Intake issues are filed one at a time, and the filer records a dependency on another issue only when
they already know about it. Nothing at filing time compares a new intake against work that is
already open or already being built. A manual pass over the 16 open v1.0 issues on 2026-08-15 found
four unrecorded dependency edges (#1529 and #1580 vs #1579; #1016 vs in-flight #1477; #1587 vs
#1487). Every one of them shared cited evidence file paths with the issue it should have depended on,
so every one was detectable mechanically.

The harness's existing overlap detection runs at plan time, after the dependent spec has already been
authored against code that another feature is rewriting. The cost shows up later as rebase conflicts,
review noise, or a wasted DECIDE. The operator specs about five features a day, so this recurs.

## Goals & Non-Goals

**Goals**
- When a new intake's cited evidence paths overlap open issues or in-flight work in the same
  repository, the filer sees that overlap as suggested dependencies before the issue is created.
- Every suggested dependency ends in an explicit, recorded decision: accepted (linked) or declined.
- A filing with no detected overlap looks and behaves exactly as it does today.
- Works in any project that uses the harness, with no dependence on this repository's layout, branch
  history, or issue history.

**Non-Goals**
- Fixing the existing failure to record dependency links on GitHub (#2714). This feature depends on
  that fix; it does not deliver it.
- Detecting overlap for issues filed through the GitHub web or mobile issue form.
- Changing the plan-time overlap scan or the set of branches it inspects.
- Semantic or content-similarity matching beyond shared cited file paths.
- Automatically linking a dependency without the filer's decision.

## Users / Personas

- **Operator filing from a terminal.** Wants to learn about collisions while context is warm, with
  one keystroke per suggestion and no extra steps when there is nothing to report.
- **Agent filing on the operator's behalf** (non-interactive: halt monitor, follow-up proposals, bugs
  found mid-build). Cannot answer a prompt. It needs a deterministic signal that a decision is
  required and a way to record that decision on a re-run.
- **Engineer running DECIDE later.** Benefits from dependency links that were recorded at filing time
  instead of discovered by a manual audit.

> **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** The agent persona means an agent that uses the intake filer command. Filings the engine makes on its own (daemon review-deferral and beyond-scope follow-up issues) are unchanged and never refused, because a refusal there would be a downstream failure mode. In-flight work that has already shipped under squash-merge is not in flight and is never reported.

## Functional Requirements

- **FR-1:** Before creating an issue, the filer determines which file paths the new intake cites as
  evidence (title and body).
- **FR-2:** The filer compares those cited paths against the paths cited by every **open** issue in the
  target repository. Each open issue that shares at least one cited path becomes a suggested
  dependency, reported together with the shared paths.
- **FR-3:** The filer compares the cited paths against the changed files of the target repository's
  **unmerged in-flight work**: spec branches awaiting build and daemon build branches. Each in-flight
  branch that changes at least one cited path is reported as an overlap together with the shared
  paths.
- **FR-4:** When an overlapping in-flight branch traces back to an originating issue, that issue is
  offered as the suggested dependency. When it does not, the overlap is still shown as advisory
  (naming the branch and shared paths), but it cannot be linked and needs no decision.
- **FR-5:** A suggestion that names the same issue through more than one source (open-issue overlap and
  in-flight overlap) is shown once, with all its shared paths merged.
- **FR-6:** Suggestions are ordered by number of shared paths, most first. Only a bounded number are
  shown, and the output says how many more were omitted.
- **FR-7:** A suggested issue that the filer already named as a dependency for this filing is treated as
  accepted and is not shown again as a suggestion.
- **FR-8:** With no overlap detected, filing proceeds exactly as today: no prompt, no extra required
  input, no refusal, and the same output apart from at most one line confirming that the check ran.
- **FR-9:** With overlap detected and the filer attached to an interactive terminal, the filer is asked
  to accept or decline each linkable suggestion before the issue is created. Accepted suggestions are
  linked as dependencies exactly like dependencies the filer supplied up front.
- **FR-10:** With overlap detected and no interactive terminal, and at least one linkable suggestion
  still undecided, the issue is **not created**. The filer exits unsuccessfully and prints every
  undecided suggestion with its shared paths, plus how to accept or decline each one on a re-run.
- **FR-11:** On a non-interactive re-run, the filer can decline specific suggested issues explicitly.
  Once every linkable suggestion is either accepted or declined, the issue is created.
- **FR-12:** Every declined suggestion appears in the filer's output as an explicit decision naming the
  declined issue. When the filing ends with no dependencies at all, the existing explicit
  "no dependencies" decision is still reported.
- **FR-13:** Declining an issue that was not suggested is rejected as an invalid decision before
  anything is created, so a typo cannot silently suppress a real suggestion.
- **FR-14:** If any part of the overlap check cannot complete (for example, open issues cannot be read,
  no local checkout of the target repository is available, or a branch cannot be compared), filing is
  never blocked by that failure alone. The filer reports which part was skipped and why, still
  enforces the decision rule (FR-9/FR-10) for any suggestions it did find, and otherwise files as today.
- **FR-15:** The in-flight comparison inspects the local checkout that belongs to the **target**
  repository of the filing. When the filing targets a repository whose local checkout is unknown, the
  in-flight comparison is skipped and reported (FR-14); it never compares against an unrelated
  repository's branches.
- **FR-16:** Each run of the overlap check and its outcome is observable afterward: the number of
  suggestions, which were accepted, which were declined, and which parts were skipped.
- **FR-17:** The intake filing guidance tells filers, and especially non-interactive agents, how to act
  on a refusal: review the suggestions, then re-run with each one accepted or declined.

## Non-Functional Requirements

- **No added interaction in the common case.** A no-overlap filing needs no additional input
  (FR-8).
- **Bounded cost.** The check adds a bounded amount of time to a filing, regardless of how many open
  issues or branches the repository has. When a bound is hit, that is reported as a partial check
  (FR-14), never a hang.
- **Read-only.** The check only reads the tracker and the local repository. It creates, edits, or
  comments on nothing except the new issue's own dependency links.
- **Portability.** No dependence on this repository's paths, branch names beyond the harness's own
  spec and daemon branch conventions, issue numbers, or labels.
- **No false exact matches.** Paths match exactly after normalization. A path does not match a
  different file that merely shares a prefix, a suffix, or a file name.

## Acceptance Criteria / Success Metrics

- Replaying the four 2026-08-15 cases as fixtures surfaces each missed edge as a suggestion at filing
  time.
- A filing with no overlap produces the same issue, labels, and dependency outcome as today, with no
  prompt.
- A non-interactive filing with overlap creates no issue until every linkable suggestion is accepted or
  declined, and then creates exactly one issue.
- A failed tracker read or missing local checkout never prevents a filing that would otherwise succeed.
- Every FR is covered by a passing test.

## Scope

### In Scope
- Overlap detection at filing time against open issues and in-flight spec and daemon branches of the
  target repository.
- Interactive accept/decline, non-interactive refusal, and an explicit per-issue decline decision.
- Filer output and observability for suggestions, decisions, and skipped parts of the check.
- Updating the intake filing guidance (skill and user guide) to cover the new behavior.

### Out of Scope
- #2714 (recording the dependency link on GitHub). This feature's accepted links rely on it.
- Web/mobile issue-form filings.
- Plan-time overlap scan changes.
- Retroactively auditing already-filed issues.

## Key Decisions & Rationale

- **Detect overlap before creating the issue, not after.** The desired outcome is to catch the
  dependency before any spec is authored against a shifting base. Reconciling at claim time was
  rejected because it surfaces the overlap only after the issue exists.
- **Enforce the decision at the filer, not in guidance alone.** A check that filers had to remember to
  run was rejected because direct filings bypass it (machinery-by-default).
- **Non-interactive filings refuse rather than auto-decide.** Auto-linking would record false
  dependencies. Filing silently past an overlap is exactly today's failure. Refusing until the filer
  decides is the only option that guarantees a recorded decision without guessing.
- **A failure inside the check never blocks filing (FR-14).** Losing an intake while its context is
  warm costs more than one missed suggestion. This matches the filer's existing rule that only a
  failure to create the issue itself is fatal.
- **Declines are recorded in the filing's output and telemetry, not in the issue body.** This keeps the
  author's text untouched and matches today's explicit "no dependencies" decision.

## Dependencies

- GitHub issues and dependency ("blocked by") links in the target repository. This is an existing
  external constraint.
- #2714. Until it ships, an accepted suggestion is attempted but its link is not recorded on GitHub
  (the existing warning path applies).
- The harness's existing branch conventions for spec branches and daemon build branches.

## Open Questions

For architecture-review:

- **Recognizing a cited path.** Extract any path-shaped token, only tokens that exist in the target
  repository, or only explicitly formatted citations? The trade-off is recall versus false
  suggestions.
- **Reuse versus a new scanner.** Reuse the plan-time overlap scan's path intersection and
  merge-base diff, or build a filing-specific scanner?
- **Locating the target checkout.** How does the filer find the local checkout of the target
  repository, given that it currently always runs from inside the harness's own directory? Options
  include the project registry, the invoking directory, or an explicit input.
- **Tracing a branch to its issue.** How does an in-flight branch trace back to its originating issue
  (FR-4)?
- **Choosing the bounds.** What caps the number of open issues read, branches compared, and
  suggestions shown (NFR bounded cost, FR-6)?
