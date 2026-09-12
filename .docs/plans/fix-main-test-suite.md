# Implementation record: Repair main's release documentation test

Status: Operator-requested hotfix outside the managed lifecycle.

## Outcome

The maintain-documentation contract checks publication provenance in `ARCHITECTURE.md`,
where #2518 moved the release mechanics. Root instruction checks continue to cover
implementation-branch restrictions, PR metadata, migrations, and consumer isolation.
The negative publication-policy probe remains intact.

## Validation

The existing test reproduced the exact CI failure before the repair and passes after it.
Test-inclusive type checking, lint, repository integrity, and the configured aggregate
suite validate the completed change before publication.

This record supplies the identity for the required manual shipped record.
