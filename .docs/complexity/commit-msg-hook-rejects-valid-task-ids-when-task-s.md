# Complexity: commit-msg hook rejects valid Task ids when task-status.json ids are numeric (#501)

Tier: S

## Rationale

- Contained bugfix across four known files: `task-seed.ts` (write-site id
  canonicalization), `git-hook-assets.ts` (commit-msg hook comparison + error
  message), `session-hook-assets.ts` (PRE hook comparison), `task-cli.ts`
  (findIndex comparison).
- No new models, integrations, auth, state machines, schema changes, or CLI
  surface. Behavior change is strictly "valid ids stop being rejected" plus a
  more diagnosable error string.
- Existing test suites cover all four surfaces (`git-hook-assets.test.ts`,
  `session-hook-behavior.test.ts`, `task-cli.test.ts`, `task-seed.test.ts`);
  the fix adds numeric-id-shape cases alongside the string-shape ones.
- Expected story count: 3 (validate numeric ids, canonical write shape,
  diagnosable rejection), each with happy + negative paths.

Per tier S: /prd (technical track anyway), /architecture-diagram,
/architecture-review, and /conflict-check are skipped.
