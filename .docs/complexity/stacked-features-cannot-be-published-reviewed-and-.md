# Complexity: Publish, review and ship a stacked feature as a GitHub native stack (#2945)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | New: a durable child-to-PR map beside the leaf-owned `pr_url`; a published-stack record (stack number, member PRs, recorded remote tip per member); a dedicated sweep-skipped halt class for published-stack tip divergence; non-leaf member lifecycle events on the existing spine |
| External integrations | New GitHub surface: the stacks REST endpoints (`POST /repos/{o}/{r}/stacks`, `POST …/stacks/{n}/add`, `GET …/stacks/{n}`), a pull-request base retarget, and child-branch pushes. Each one goes through the guarded GitHub operation registry and `executeRemoteGit`. `ci.yml`'s `pull_request` trigger may need to cover child-branch bases |
| Auth / permission surface | Guarded mutation policy must authorize writes to child PRs and to a repository-scoped stack resource. The leaf-exists and committed-owner checks (`adr-2026-09-11-github-operation-ownership` D2, umbrella D3) apply to every child write |
| State machines | FINISH publication moves from one PR to an ordered, resumable multi-member sequence: leaf draft at SHIP entry → leaf gates pass → push and open children → retarget leaf → assemble stack. The mergeable sweep moves from one PR per slug to a stack whose ship is the leaf merge. A lower-prefix merge stays in flight. Teardown waits for leaf merge proof |
| Story count | ~10–13: child push with lease, idempotent child-PR creation, leaf retarget plus re-keyed retained-draft lookup, stack assembly with resume, child-scoped bodies and stack navigation, leaf-only feature sections, every member passes required checks (CI on stacked bases), leaf-only ship and dedup, member reachability verification, non-leaf lifecycle events, explicit-name teardown and reclaim, tip-mismatch halt, N=1 parity |
| Files touched | ~20–30: `finish-publication.ts`, `finish-publication-production.ts`, `ship-draft-pr.ts`, `conductor.ts` (retained-draft lookup, SHIP gates), `github-operations.ts`, `tracker-client.ts`, `owner-gate/mutation-policy.ts`, `push-lease.ts`, `remote-git-operations.ts`, `mergeable-sweep.ts`, `daemon-cli.ts`, `daemon-backlog.ts`, `finish-record-cli.ts`, `shipped-record.ts`, `merged-pr-guard.ts`, `halt-marker.ts`, `daemon-rekick.ts`, `halt-record.ts`, `autoresolve.ts`, `types/state.ts`, `types/events.ts`, `.github/workflows/ci.yml`, plus the stalled-feature runbook and releases docs |
| ADR work | A new publication ADR amends `adr-2026-07-29-ship-start-draft-pr`, `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`, `adr-2026-09-24-project-owned-pr-body-regions` D4/D5, `adr-2026-07-07-finish-record-primitive` D3/D4, `adr-2026-07-25-fail-closed-durable-shipment-evidence` (deliberate reliance on zero-match for children), and the chain ADRs' #2945 deferrals: umbrella D2/D3, build-region D11, restack D9/D11 |

## Rationale

Large. This is the first time the engine publishes more than one PR per feature and treats a
partial merge as not-a-ship. A mistake records a false ship and closes the intake when only a
lower child merges (the #438 class), leaks child branches at teardown, or pushes an unvalidated
tip to a published member. Every remote write is new GitHub surface behind the guarded operation
path, and the publication sequence must be resumable across crashes at each of five points. The
operator narrowed scope to the ship path (adopt recovery, routed-fix comments, red-CI surfacing
and dedicated release contracts are split to #3268, #3269, #3270 and #3267), but the remaining
core still needs a full architecture review because it amends several approved ADRs on the
publication and shipment-evidence contracts.
