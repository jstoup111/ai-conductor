# Conflict Check: conduct-state mutation port

**Date:** 2026-08-01
**New stories:** `.docs/stories/conduct-state-json-lost-update-conductor-s-whole-o.md`
**Inventory:** 277 story files plus active specs and prior conflict reports
**Verdict:** PASS — zero blocking conflicts, zero accepted degrading conflicts

## Pairwise Result Within the New Story Set

| Pair / interaction | Conflict types checked | Verdict and grounding |
|---|---|---|
| TS-1 disjoint updates vs TS-2 same-field conflicts | contradiction, overlap, state conflict | Compatible (99%, verified from accepted text): TS-1 applies to different fields; TS-2 applies when expected/current/requested values compete for the same field. |
| TS-1 atomic batch vs TS-3 serialized adapter | overlap, resource contention, sequencing | Compatible (99%, verified): serialization is the boundary that makes the batch all-or-nothing; neither story assumes it can bypass the other. |
| TS-2 terminal completion vs TS-4 explicit reset | contradiction, state conflict | Compatible (99%, verified): `complete` wins only against ordinary mutations; TS-4 defines privileged replace/reset as the explicit authority to clear it. |
| TS-2 `done → stale` vs existing invalidation stories | contradiction, state conflict | Compatible (99%, verified): post-rebase and backward-navigation stories require deliberate invalidation; TS-2 explicitly preserves it and rejects generic `done` precedence. |
| TS-3 lease recovery vs TS-5 replaceable adapter | overlap, sequencing | Compatible (95%, verified/inferred): lease behavior belongs only to the local adapter; the port exposes typed outcomes without requiring future adapters to copy filesystem mechanics. |
| TS-4 compatibility vs TS-5 bypass prohibition | contradiction, sequencing | Compatible (99%, verified): reads retain the flat JSON contract while production writes migrate behind the port; compatibility does not authorize direct writes. |

## Adjacent Existing Contracts

| Existing contract | Interaction | Verdict |
|---|---|---|
| Finish-record primitive preserves unknown fields and writes `pr_url` before its marker | TS-1/TS-5 generalize the preservation mechanism without changing the terminal write ordering or corrupt-file refusal. | No conflict (99%, verified from existing stories and conflict report). |
| Parallel validation uses a single-writer join for branch outcomes | The group core remains the client that submits state mutations; validators still do not become state writers. | No conflict (95%, verified from stories/ADR). |
| Conductor backward navigation and post-rebase invalidation change completed steps to `stale`/`pending` | TS-2 explicitly refuses a generic terminal ranking for step statuses. | No conflict (99%, verified). |
| `--reset` and interactive start-over clear state | TS-4 retains clearing through a privileged replacement operation. | No conflict (99%, verified). |
| Existing readers consume flat `conduct-state.json` fields | The ADR and TS-4 retain the JSON read shape; only mutation authority changes. | No conflict (95%, verified design commitment). |
| Feature completion is terminal for ordinary control flow | TS-2 registers `feature_status: complete` as the initial semantic precedence rule while TS-4 preserves explicit reset authority. | No conflict (99%, verified). |

## Five-Type Scan

- **Contradiction:** none. Ordinary mutation and privileged reset are explicitly distinct.
- **Behavioral overlap:** intentional and compatible at the common store boundary.
- **State conflict:** resolved by expected-value checks, atomic batches, narrow precedence, and typed refusal.
- **Resource contention:** resolved by the single-host adapter lease; independent worktree paths remain isolated.
- **Sequencing conflict:** port/types precede adapter and writer migration; reset and finish ordering remain explicit.

## Verify-Claims Verdict

All interaction claims above cite accepted story or approved architecture text. No unconfirmed load-bearing assumptions were used.

Verdict: CLEAR
