# Track: On-demand regeneration of the bot-owned release PR

Track: technical

Scope boundary: Small fix for #1274, approved by the operator on 2026-09-06 (delegated). Add a manual trigger to the release-PR maintenance workflow so an operator can regenerate the bot-owned release PR against current repository state without merging anything, restrict a manual run to the repository's default branch, and prove the manual path keeps the existing serialization and App-provenance contract. Changing candidate collection, the renderer, the completeness policy, the publisher, or adding workflow inputs is outside this slice.

This is repository CI configuration for this harness's own release machinery; acceptance criteria live in technical stories rather than a PRD.

The operator's delegate approved adding a bare `workflow_dispatch` trigger over the alternatives of a scheduled rebuild (spends CI on quiet repositories and still cannot be aimed at a just-corrected state) and a repository_dispatch webhook (needs a token holder outside GitHub's own UI), on 2026-09-06 (delegated). The hypothesis in the issue is the recommended approach because the job already derives every input from repository state rather than the event payload.

Scope check: A — harness-repo-only, decided by repo-only signal 3 (this repository's own CI under `.github/workflows/`) and signal 2 (its own release gates); B — n/a, no new skill; C — provider-agnostic, no provider path, variable, or capability is touched. Registration: none required; no skill, model-table row, or catalog entry changes.

Verified foundation: the maintenance workflow declares exactly one trigger, a closed pull-request event, and gates its single job on `github.event.pull_request.merged`; its checkout resolves the merge commit from that same payload. Everything after checkout reads repository state — the default branch from the repository payload, the latest release tag and candidate range from Git, and merged-PR metadata from the API — so no step other than the guard and the checkout reference is event-shaped. Serialization is a job-level concurrency group that is not keyed on the event, and every mutation runs under a GitHub App installation token minted inside the job. The publisher workflow triggers on pushes to the default branch and re-derives release authority from the merged release PR's App ownership and its head-bound candidate-audit check; it never inspects which event produced that PR, so a manually regenerated release PR is indistinguishable to it.
