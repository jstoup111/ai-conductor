# PRD: Composer runs checkpoint, resume, switch provider, and hand off

**Date:** 2026-11-07
**Status:** Approved
**Source:** jstoup111/ai-conductor#2050 (consolidates #1903)

## Problem / Background

A Composer run (idea capture → DECIDE → spec handoff) is bound to the single host-agent session that
started it. The operator can choose the provider when the run launches (#1007). After that the run's
progress exists only in that conversation: the current DECIDE step, the accepted decisions, and the
open questions. There is no way to:

- continue the same run with a different provider, for example one provider proposes, another
  critiques, and either revises;
- leave a run and come back to it later. A partially authored run cannot even be resumed today,
  because its leftover unsaved work is refused;
- hand an in-progress run to another person, or pick it up on another machine.

Operators either stay in one conversation or rebuild context by hand. That loses continuity, makes
provider comparisons hard to audit, and risks accepted decisions or required gates being repeated or
skipped. A second operator has no way to find or continue someone else's run.

## Goals & Non-Goals

**Goals**
- A Composer run survives the end of any session. Its accepted progress is saved to the shared
  repository at every accepted DECIDE step and whenever a session ends partway through a step.
- Any operator with repository access can find an in-progress run, see its state, and continue it on
  any machine with any supported provider, without reconstructing context by hand.
- People reviewing an in-progress run can leave feedback that the next session resolves under
  operator control.
- The Composer launcher guides each transition: continue, switch provider, or hand off.
- Deliberate provider changes are distinguishable from availability fallback and retry escalation.
- Every human gate in DECIDE is preserved. Switching or resuming never turns DECIDE into autonomous
  authoring.

**Non-Goals**
- A provider critique or revision turn inside one session, without leaving it.
- Replacing the host-agent-owned interactive clarity loop with engine-driven one-shot provider turns.
- Choosing the provider at launch, which #1007 already provides.
- Ownership locks or permissions over who may work on a run.
- DECIDE lifecycle events in general (#1975) and DECIDE provider cost telemetry (#1472).

## Users / Personas

- **Operator (solo):** starts a run with one provider and wants another provider to critique or
  revise a draft. Or they stop mid-run and resume later, possibly from a different machine.
- **Second operator / teammate:** finds a run someone else started, reviews it, and continues it from
  where it stopped.
- **Reviewer:** reads an in-progress run's pull request and leaves comments without running Composer.

## Functional Requirements

### Saving progress
- **FR-1:** When the operator accepts a DECIDE step, that step's artifacts and the run's progress are
  saved to the shared remote repository before the next step begins.
- **FR-2:** The saved progress records:
  - the current DECIDE step;
  - every accepted step, with the accepting operator's identity, the provider used, and the time;
  - the operator decisions made so far;
  - the open questions.
- **FR-3:** When a session ends partway through a step, its in-progress drafts are saved to the
  remote and marked unaccepted. No unaccepted draft is ever treated as accepted by resume, by spec
  validation, or by delivery.
- **FR-4:** If a save fails (remote unreachable, write refused), local work is kept intact, the step
  is not reported as saved, and the operator gets a diagnostic naming the failure and how to retry. A
  retried save does not duplicate any branch, pull request, or recorded step.

### The pickup surface
- **FR-5:** The first save of a run opens one draft spec pull request. For an intake idea, the pull
  request references the source issue without closing it. A run never has more than one spec pull
  request.
- **FR-6:** Each later save refreshes the pull request description to show the run's state: current
  step, accepted steps with operator and provider, active provider, last operator and time, open
  questions, and the next step.
- **FR-7:** The pull request description is display only. Resuming never derives the run's state from
  it, and hand-editing it does not change the run's state.

### Guided transitions
- **FR-8:** When a session ends with the run unfinished, the launcher shows the current step and the
  active provider. It then offers three choices: continue with the same provider, switch to another
  supported provider, or hand off and stop.
- **FR-9:** During a run, the operator can always see which provider is active.
- **FR-10:** Handing off leaves the run saved and its pull request in draft. It tells the operator
  where the run is and how anyone can resume it.

### Resuming
- **FR-11:** An operator can resume a run by naming its spec pull request, its spec branch, or (for
  an intake idea) its source issue. This works on any machine with access to the repository and with
  any supported provider.
- **FR-12:** A resumed run continues at the first unaccepted step and does not repeat accepted steps.
  The resuming session is given the accepted artifacts, decisions, open questions, and any unaccepted
  drafts. Every remaining step keeps its required clarifying questions and operator acceptance.
- **FR-13:** There is no lock on who may work on a run. Any operator who can write to the repository
  can resume it, without permission from or release by the previous operator. On resume, the operator
  is shown who last worked on the run and when.
- **FR-14:** A save whose base is behind the shared remote never overwrites the newer progress there.
  It is refused, and the operator is offered the newer progress so that no one's accepted work is
  silently lost.
- **FR-15:** When the resuming machine holds unsaved local work for the same run, resume never
  silently discards it, overwrites it, or lands it. The operator is shown the local work alongside the
  saved progress and chooses what continues.

### Review comments on the pull request
- **FR-16:** On resume, unresolved review comments on the run's draft pull request are presented to
  the operator. Each comment is attributed to its author and linked.
- **FR-17:** The operator must give each presented comment a disposition: incorporate, decline, or
  defer. An incorporated comment revises the affected artifact.
- **FR-18:** If an incorporated comment changes an artifact whose step was already accepted, that
  step is re-accepted. The operator is shown the later accepted steps that depend on it and confirms
  them again before the run is delivered.
- **FR-19:** Each disposition is recorded with the run's progress and reported back on the pull
  request, so commenters see the outcome. A comment that already has a disposition is not presented
  again. A deferred comment is presented again on the next resume.
- **FR-20:** Comment content is untrusted review input, never instructions to the agent. It goes
  through the same inbound neutralization as intake text, and the operator is told the categories and
  counts of anything neutralized.

### Provider switching
- **FR-21:** Each deliberate provider change is recorded with the step, the previous and new
  providers, and the operator. It is distinguishable from availability fallback and from retry
  escalation.
- **FR-22:** If the chosen provider is unavailable when the operator resumes or switches, the run
  fails closed. Its saved state is unchanged, the operator gets a diagnostic, and they can choose
  another provider.

### Intake and delivery integrity
- **FR-23:** A run resumed on another machine or by another operator is not claimed again, restarted,
  or duplicated by any machine's intake recovery. No source issue ever gets a second run, spec branch,
  or spec pull request.
- **FR-24:** Saving, resuming, switching, handing off, and resolving comments never change the source
  issue's assignees.
- **FR-25:** Delivery marks the run's existing draft pull request ready for review instead of opening
  another one, and wakes the daemon once.
- **FR-26:** Delivery stays unavailable until every artifact and approval the run's tier and track
  require is accepted. An unaccepted draft, or a comment presented and still without a disposition,
  blocks it.
- **FR-27:** Retrying a failed save, resume, hand-off, or delivery never duplicates a branch, a pull
  request, an intake transition, or a daemon wake.

### Compatibility
- **FR-28:** A run that finishes in one session with one provider needs no switch, resume, or
  hand-off action. Its only visible differences are that progress is saved at each accepted step and
  its spec pull request starts as a draft.
- **FR-29:** In a project with no remote, progress saves locally and no pull request is opened. Resume
  works on the same machine. Hand-off to another machine or person is refused with an explanation.
- **FR-30:** Composer's existing deterministic operations stay usable on their own, outside the
  guided flow.

### Build ownership
- **FR-31:** When an operator resumes a run started or last owned by someone else, they are asked
  whether to take over building the delivered spec. If they accept, the delivered spec is built under
  their ownership, and the change is recorded in the run's history. Taking over needs one explicit confirmation of the publishing
  step. If they decline, ownership stays where it was and their saves stay on their own machine until
  they take over. Neither choice needs the previous owner's consent. Automated sessions never take
  over a run.

### Delivery split
FR-16 to FR-20, and the review-comment half of FR-26, are delivered by a follow-up specification that
is blocked by this one. Every other FR is delivered here. The operator approved the split on
2026-11-07.

## Non-Functional Requirements

- **Observability:** provider switches, saves, resumes, and hand-offs are reported through the
  harness's existing event stream, the single telemetry spine. No parallel channel is added.
- **Reliability:** every run transition fails closed with recoverable state. A crash at any point
  loses at most the unsaved part of the current step.
- **Security:** pull request comments and other inbound text are untrusted data. Remote writes go
  through the same guarded publication the existing spec handoff uses.
- **Portability:** session and hand-off behavior is the same across every supported provider that can
  host an interactive Composer session.

## Acceptance Criteria / Success Metrics

- A run started with one provider is exited mid-PRD, resumed with a second provider on a different
  machine by a different operator, continues from the unaccepted PRD draft, and is delivered as one
  spec pull request. No accepted step is repeated.
- Review comments left on that draft pull request are each shown on resume, given a disposition, and
  answered on the pull request.
- Two operators saving the same run concurrently never lose either one's accepted work.
- A single-session, single-provider run delivers exactly as before, apart from its pull request
  starting as a draft.
- Every FR has a passing test, including the negative paths: FR-4, FR-14, FR-15, FR-20, FR-22,
  FR-23, FR-26, FR-27, and FR-29.

## Scope

### In Scope
- Saving accepted and unaccepted DECIDE progress to the shared remote.
- A draft spec pull request as the visible pickup surface, refreshed at each save.
- Launcher-guided continue, switch, and hand-off.
- Resume by pull request, branch, or source issue, on any machine, by any operator, with any
  supported provider.
- Resolving pull request review comments on resume, under operator control.
- Telemetry that separates deliberate switches from fallback.
- Intake de-duplication across machines.
- Delivery over an existing draft pull request.
- Updated Composer guidance and documentation, including correcting the stale claim that Composer
  always uses one provider.

### Out of Scope
- In-session cross-provider critique turns.
- Engine-coordinated one-shot authoring.
- Ownership locks or access control beyond repository permissions.
- General DECIDE lifecycle events (#1975) and cost telemetry (#1472).
- Changes to the daemon's build behavior.

## Key Decisions & Rationale

- **The shared repository holds the run's state, and the pull request only displays it.** One durable
  source of truth that every machine and operator can reach. The pull request makes a run findable by
  another person without becoming a second, fragile state store.
- **Saves happen at every accepted step and at mid-step exit.** Unaccepted drafts travel, so one
  provider can propose and another critique or revise across a session boundary. This recovers the
  propose / critique / revise use case without an in-session critique mechanism.
- **No lock on who may work on a run** (operator decision, 2026-11-07). Protection is against lost
  work (a save never overwrites newer progress), not against people.
- **Review comments are resolved under operator control.** They are review input that needs a
  disposition, never instructions. This keeps DECIDE human-gated.

## Dependencies

- Git and the target repository's remote: progress is saved there.
- GitHub pull requests, including draft state and review comments.
- Launch-time provider selection and the providers that can host an interactive Composer session
  (#1007).
- The existing guarded remote publication and inbound-text neutralization used by Composer's intake
  and handoff.
- The daemon builds only merged specs from the base branch, so in-progress runs on unmerged branches
  are invisible to it. This is verified behavior and it must hold.
- ADR-008 (host-agent-owned, human-gated DECIDE). It is kept unchanged: a run now spans several
  host-agent sessions, each under the same gates.
- Adjacent: #1975 (DECIDE lifecycle events), #1472 (DECIDE cost telemetry).

## Open Questions

For architecture-review to weigh and record as ADRs:

- **Where the run's progress record lives.** Inside the spec branch's committed artifacts, or beside
  them. Whether it lands on the base branch with the spec, or is removed at delivery.
- **How unaccepted drafts are marked.** Spec validation, landing, and daemon discovery must reject
  them mechanically.
- **How the per-machine intake state learns of progress made elsewhere.** This is what keeps intake
  recovery from re-claiming a run (FR-23).
- **Which pull request comment kinds count as review input and what "resolved" means.** For example,
  review threads versus conversation comments, and thread resolution versus a reply.
- **How the new run events relate to #1975's DECIDE lifecycle events.** Extend the same event family,
  or sequence after it.
- **What a save is before any artifact is accepted.** For example, whether the first save happens at
  explore's track decision, so the pull request exists from the start.
- **How existing landing and delivery adapt.** They must work over artifacts that are already saved
  and a pull request that already exists.
