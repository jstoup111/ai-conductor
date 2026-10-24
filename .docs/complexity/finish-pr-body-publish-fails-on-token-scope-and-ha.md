# Complexity: FINISH reports the real PR-publish failure instead of "pr.prose unchanged"

Tier: M

Rationale: Adds one `ConductorEvent` variant (`github_operation_failed`) emitted by the
`github-operation` CLI (`src/conductor/src/engine/github-operations-cli.ts`, already wired to the
worktree spine through `startOperatorEventSpine`), and one FINISH human-required reason consumed by
the publication coordinator (`src/conductor/src/engine/finish-publication.ts`) through a new
observation of the authoring pass in `src/conductor/src/engine/finish-publication-production.ts`.
The correlation crosses a process boundary — the provider's CLI subprocess writes the spine, the
engine reads it back for one PR and one authoring window — which is a design decision that needs a
lightweight architecture review and an ADR, not a localized edit. It extends the event union and
the FINISH disposition vocabulary (both persisted/rendered contracts). No new module, dependency, CLI flag, or settings schema; the existing "unchanged" halt
path stays as the negative case. Scope excludes the PR-edit transport and credential-fallback
classification.
