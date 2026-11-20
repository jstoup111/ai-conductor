# Shorter spec reviews (#3419)

**Date:** 2026-11-19  
**Status:** Approved

## Problem and users

A reviewer tracing one acceptance criterion can encounter its full wording in the stories, the implementation plan and the coherence table. Each copy raises a question for the reader: does this version say anything different? The author also has to keep the copies consistent. Issue #3419 cites a concrete example from #3278, where the plan and coherence record together occupied 64,090 characters.

## Goals and scope

Give reviewers of new specs a clearly identified reading set that contains the decisions they must assess. Preserve the detail implementers need to execute tasks and the evidence validators need to judge coverage. Historical spec migration is outside this feature.

## Functional requirements

- **FR-1.** A reviewer can find each acceptance criterion stated in full in exactly one place and identify that same criterion wherever a task or coverage check depends on it.
- **FR-2.** Before opening any files, a reviewer can distinguish the material intended for their review from machine bookkeeping by where each is listed.
- **FR-3.** For the same Medium or Large spec, the complete set of material a reviewer must read is materially shorter. It still communicates the proposed behavior, design decisions and implementation scope.
- **FR-4.** When any acceptance criterion lacks a corresponding task completion check, landing is refused and the refusal identifies every uncovered criterion.
- **FR-5.** Land coherence, plan review, PRD audit and coverage judgement each retain access to the full evidence needed to assess the same obligations as today.
- **FR-6.** A spec authored interactively and an equivalent composer-authored spec expose the same review material and supporting evidence to downstream readers.
- **FR-7.** A spec authored before adoption can still build, undergo review and ship using its existing artifacts.
- **FR-8.** Operators can use the existing shipped-feature cleanup workflow on the new layout. It proposes removal of eligible artifacts, retains durable records and defers a feature when an open change touches a cleanup candidate.

## Acceptance criteria and success measures

Compare the full reading set for the same Medium and Large examples before and after adoption. Report the character counts and show which repeated passages were eliminated. Keep the decisions, criteria and task checks fixed for the comparison. Count anything reviewers must open to understand the proposal, wherever it sits. Use the #3278 example as a reference point for the Large case; its quoted subtotal covers only two documents.

For gate parity, review equivalent complete and incomplete examples. Check that a complete mapping is accepted, multiple missing mappings are all named, and the evidence behind a review finding remains accessible on both authoring routes. Exercise an existing spec through review, build and ship.

Verify cleanup on a mix of old and new specs, including an unshipped feature and a shipped feature with an open edit. Inspect the proposed deletion list, confirm the durable records remain readable and recover the full shipped plan through the historical lookup after cleanup.

## Key decisions and rationale

After shipment the plan summary and full plan are both eligible for cleanup. Requirements, stories, architecture and decisions remain available.

The operator selected the full scope and product track. Reviewers need to know what to open as well as what they can read once. The comparison uses the total reading burden so moving required prose to another document cannot count as a saving.

## Dependencies

The existing feature manifest (#3405), manifest-based ownership (#3418), indexed plan review (#3404) including its fallback, and the decision corpus covered by #1480 constrain compatibility. The approved manifest decision sequences delivery after #3418.

## Open questions

The approved review set comprises requirements where applicable, stories, architecture and a plan summary, with links to material decisions and findings. The issue sets no numerical reduction target; acceptance should show the measured saving and the content that accounts for it.
