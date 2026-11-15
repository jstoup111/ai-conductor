# Complexity: Unassigning a captured intake issue does not withdraw it from claim

Tier: S

Rationale: Three production files, one logical change. `src/conductor/src/engine/engineer/intake/github-issues.ts`
exports its existing current-assignees read as a shared helper (the write-back authorization keeps
using it). `src/conductor/src/engine/engineer/intake/delivery-guard.ts` gains one optional owner
resolver dependency and one serve-time check beside its existing closed-issue probe, reusing the
guard's existing hold-and-release path for candidates it will not serve.
`src/conductor/src/engine/engineer-cli.ts` passes the existing machine-owner resolver
(`intakeResolveActor` seam, else `resolveDaemonOwner`) into the claim guard. No new module, ledger
status, schema, config key, CLI flag, claim output field, or event variant; stderr skip lines use
the guard's existing logger. The bulk of the diff is tests: one new entry-point suite plus fixture
updates so existing claim-path fakes answer the new assignees read. Not hotfix-eligible: the change
exceeds the two-file, ~15-line bound and needs more than two focused tests.
