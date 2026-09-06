# Track: Reject non-date-named ADRs at spec land

Track: technical

Scope boundary: Small fix for #705, approved by the operator on 2026-09-06 (delegated). Enforce the
documented canonical ADR filename form at the composer land gate, for ADRs the landing spec
introduces. Decision records already present on the base branch at the spec's merge base — including
the eleven legacy sequential-number files — are out of scope and must keep landing unchanged, as
must any later edit to them. Adding a repository-wide filename sweep to the integrity suite,
renaming any committed decision record, widening the check to review or assessment records in the
same directory, and touching daemon backlog discovery are all excluded. Documentation is delivered
by the repository's own documentation step, not by a plan task.

This is an internal enforcement correction to an already-published authoring convention; acceptance
criteria live in technical stories rather than a PRD.

The operator-delegated decision on 2026-09-06 was change-set scoping over a grandfather allowlist.
The land gate already scopes its ADR citability rung to the ADRs a spec added or changed, so
restricting the naming rung to records absent at the merge base reuses a proven boundary and needs
no allowlist to maintain. An allowlist was rejected: it would have to enumerate the eleven legacy
files forever and would still refuse a legitimate later edit to one of them.

Scope check: A — consumer-facing (the composer land gate ships to every repository that installs the
harness, and a fresh consumer authoring its first decision record gets the same enforcement; no
self-host, daemon, release-gate, or repository-private convention signal fires); B — n/a (no new
skill); C — provider-agnostic (a deterministic engine check with no host-specific path, variable, or
capability). No catalog registration is required.

Verified foundation: the architecture-review skill states the canonical form and forbids sequential
numbers, and the conflict-check skill repeats it, but no code enforces it. The land primitive already
lists every decision record matching the ADR prefix, already builds a set of the ADR paths the spec
added or changed, and already refuses a land on an unapproved or uncitable record — so the naming
rung has an existing home, an existing enumeration, and an existing change-set boundary. Of the 308
committed ADR-prefixed records on the base branch, exactly eleven carry sequential numbers, and all
eleven predate this change; scoping to records absent at the merge base leaves every one of them
untouched.
