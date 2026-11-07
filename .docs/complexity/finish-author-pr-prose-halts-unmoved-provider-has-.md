# Complexity: FINISH author_pr_prose halts unmoved — provider has no reliable way to write PR prose

Tier: M

The change moves one responsibility — the PR title/body write inside FINISH publication — from the
provider to the engine, on existing seams. The author pass and the judge pass's repair return
schema-constrained title/body instead of editing the PR. The publication coordinator in
`src/engine/finish-publication.ts` and its production wiring in
`src/engine/finish-publication-production.ts` validate that prose and perform the guarded
`pull-request.edit` through the guarded-edit path the region-restore code already uses
(`resolveShipDraftPublicationDependencies` in `src/engine/conductor.ts`). The FINISH prompt blocks
in `src/engine/step-runners.ts` and the `skills/finish` and `skills/pr` contracts are rewritten to
match. Authoring failures gain specific disposition reasons, and the daemon-session guard in
`src/execution/daemon-session.ts` gets a non-misleading refusal for a bare `--help` or a missing
subcommand.

There is no new external service, dependency, persisted schema or CLI flag. It is more than Small
because it spans the coordinator state machine, its production adapter, the step-runner prompt
contract, two shipped skills and the session guard, and because it changes the provider↔engine
contract for FINISH. That contract carries approved ADRs, and the choice of channel for the
returned prose (handoff file or final output) is a structural decision. A lightweight architecture
review therefore applies. It is not Large: one transition family changes, and the coordinator's
re-observation authority and retry bounds stay as they are. The plan stem must remain
`finish-author-pr-prose-halts-unmoved-provider-has-`.
