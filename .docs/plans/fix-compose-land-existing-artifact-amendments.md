# Implementation record: Composer accepts existing DECIDE amendments

Status: Implemented as an operator-requested sidecar for spec PR #2443.

## Outcome

An amendment to a historical DECIDE artifact keeps its original feature identity at composer land.
It stays in the committed change set and applicable ADR/coherence checks. It cannot displace or
substitute for this feature's required artifacts. New files and rename destinations still obey
this feature's stem contract.

## Completed task

### Task 1: Separate historical amendments from current-feature artifact candidates

**Type:** infrastructure
**Story:** Support the existing HARNESS.md DECIDE amendment contract at the land boundary.
**Dependencies:** none

Inspect regular artifact paths in the Git merge-base tree, then exclude historical mismatches
from the candidate pool used for current-feature selection and stem validation. Keep the full
idea-attributed file set for commit and ADR/coherence validation. Document the behavior in the
CLI reference.

**Done when:**
- Real local-Git land fixtures preserve committed historical story/plan amendments even when they are newer than the current artifacts.
- A historical amendment cannot satisfy a missing current-feature story.
- A newly committed rename destination with a mismatched stem is rejected without creating a land commit.

## Validation

The regression failed against the original selection logic before implementation. Focused land
coverage and the configured aggregate suite exercise the corrected boundary; test-inclusive
TypeScript checking, ESLint, and full harness integrity are required before publication.

This record supplies the identity for the repository-required manual shipped record. It does not
claim that the separate widening-decision specification in #2443 has shipped.
