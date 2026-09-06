# Track: Treat completed commit-status entries as terminal for ci-fix eligibility

Track: technical

Scope boundary: Small fix for #2164, approved by the operator on 2026-09-06 (delegated). Correct the terminal-CI eligibility gate so a completed commit-status rollup entry stops being read as "still running", and label a genuinely pending commit-status entry by its own identifier instead of the placeholder. The auto-merge readiness classifiers that share the same rollup shape (overall outcome classification and the failing-or-pending predicate), the sweep's check-name log field, the attempt cap, the cooldown, and any redesign of how the rollup is fetched are outside this slice.

This is an internal daemon-tooling correction to an existing gate; acceptance criteria live in technical stories rather than a PRD.

The operator approved, on 2026-09-06 (delegated), reading the entry's own reported state rather than branching on a GraphQL type discriminator: the state field is what actually carries the outcome, the fix stays correct if the discriminator is ever absent from the fetched payload, and it degrades to today's behavior when no state is reported at all.

Scope check: A — harness-repo-only (daemon sweep and CI-fix remediation machinery, a mechanism no consumer repository has); B — n/a (no new skill); C — provider-agnostic (no host-specific path, variable, or capability is involved). No catalog registration is required. This repository's documentation-upkeep rule applies to the canonical CI-fix eligibility reference paragraph and is satisfied by the repository's own documentation step, not by a plan task.

Verified foundation: the eligibility gate calls a name-collecting helper in the CI-fix engine module that treats an empty conclusion as "still running" and falls back to a placeholder label; the merge-state fetcher requests the rollup through the GitHub CLI and passes the parsed entries through unchanged, and its declared element type carries only status, conclusion, and name. The non-terminal state set already contains the pending and expected commit-status values, so the correction is confined to how a reported state is read and how the label is chosen.
