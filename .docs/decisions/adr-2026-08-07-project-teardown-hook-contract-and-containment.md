# ADR: Project teardown hook — contract, time bound, and failure containment

**Date:** 2026-08-07
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for the bin/teardown spec

## Context

The harness runs a project-supplied `bin/setup` in each prepared worktree, exporting a
per-worktree identity so the project can provision namespaced resources. Nothing releases
them: every removal path is a bare `git worktree remove --force`. The PRD
(`.docs/specs/bin-teardown-run-a-project-supplied-teardown-hook-.md`) enumerates the release
side as FR-1 … FR-12 and defers four mechanism questions here: the time bound, the runner's
placement, coverage of the reconciliation fallback path, and whether failures need a durable
surface beyond the log. This ADR settles all four. The coverage-enforcement question is
settled separately in `adr-2026-08-07-worktree-removal-coverage-guard`.

### Grounded constraints (verified by direct read at HEAD `1fd6a9a97`)

| Claim | Basis | Confidence |
| --- | --- | --- |
| `runProjectSetup` (`worktree-prepare.ts:499`) runs the script via `execa(script, [], { cwd: worktreePath, all: true, env: { CI: 'true', [NAMESPACE_VAR]: namespace } })` with **no** `timeout` option | verified | 99% |
| `namespace = sanitizeNamespace(basename(worktreePath))` (`worktree-prepare.ts:99`) — a pure function of the path, no persisted state | verified | 99% |
| An absent `bin/setup` logs one line and returns; a non-zero exit throws `SetupFailureError` carrying a 50-line tail | verified | 99% |
| `daemon-deps.ts:126` `teardownWorktree` returns early when `keep === true`; its only `keep === false` caller is the post-ship reap at `mergeable-sweep.ts:347`. `daemon-runner.ts:357` and `:504` both pass `keep === true` | verified | 97% |
| `park-reconciliation.ts:638-652` attempts `git worktree remove --force`, and on failure falls back to `rm -rf` **only** for a path `isRegisteredWorktree` says git never registered | verified | 97% |
| The repository already carries per-concern timeout config keys with resolver + validation + default (`auth_park_timeout_minutes`, `provider_preparation_timeout_minutes` in `resolved-config.ts:470-540`) | verified | 95% |
| `execa`'s `timeout` option is already used in-repo (`mermaid-renderer.ts:406`, `timeout: 10_000`) | verified | 99% |

### Assumptions

- **A1 — a real resource release can exceed ten seconds.** Dropping a database against a
  remote or loaded instance, or releasing a cloud-side resource, plausibly takes tens of
  seconds. *Basis: inferred* (no in-repo consumer `bin/teardown` exists to measure).
  *Confidence: 80%.* *Impact if wrong:* a default bound that is merely generous rather than
  necessary — the timeout is a ceiling, not a delay, so an over-generous default costs
  nothing on the success path. **Not load-bearing**, because the decision below makes the
  bound configurable.
- **A2 — the operator accepts a bounded stall on the reap path.** *Basis: operator-confirmed*
  ("best-effort + loud log, remove anyway", plus FR-7's explicit time bound). *Confidence:
  99%.*

No unconfirmed load-bearing assumption remains; this ADR is safe to approve.

## Options Considered

### Q1 — the time bound

**Option A: reuse the in-repo 10s precedent.**
- Pros: one existing convention; minimal reap-path stall.
- Cons: near-certain to kill legitimate work (A1). A teardown killed mid-drop can leave a
  resource half-released, which is strictly worse than not running it — a partially dropped
  schema is harder to reason about than an intact orphan.

**Option B: a fixed, generous bound (no config key).**
- Pros: no new configuration surface; predictable.
- Cons: no single number fits both a local SQLite unlink and a remote managed-database drop.
  A project whose release genuinely needs longer has no recourse but to fork the harness.

**Option C: a generous default, overridable by a config key.** ← selected
- Pros: follows the established `*_timeout_*` resolver precedent in `resolved-config.ts`;
  the default protects the daemon, the key serves the outlier project.
- Cons: one more key to document and validate.

### Q2 — where the runner lives

**Option A: co-locate with `runProjectSetup` in `worktree-prepare.ts`.** ← selected
- Pros: `SETUP_SCRIPT`, `NAMESPACE_VAR`, `sanitizeNamespace`, and the output-tail helper all
  already live there. The acquire/release symmetry — the product's central promise (FR-2,
  FR-3) — is visible in one file, so a change to one side is read next to the other.
- Cons: the module's name says "prepare" while it would own a removal-time concern.

**Option B: a separate module.**
- Pros: keeps a removal-time concern out of a preparation-time module.
- Cons: must import or duplicate four shared helpers; the two halves of one contract drift
  apart in review because nobody reads them together. The symmetry is the thing most likely
  to be broken by a careless future edit, so separating the halves optimizes for the wrong
  risk.

### Q3 — the reconciliation fallback path

**Option A: invite teardown only before `git worktree remove`.**
- Cons: leaves the `rm -rf` fallback branch uncovered — the exact leftover-directory case
  where a stale provisioned resource is most likely.

**Option B: invite teardown in both branches.**
- Cons: two call sites in one function, trivially divergent; and it would run teardown after
  a failed removal attempt, from a less-known state.

**Option C: invite teardown once, before the removal attempt.** ← selected
- Pros: a single invocation covers both branches by construction — the directory is intact
  and the project's script is readable at that moment, which is exactly the state FR-1
  requires. No duplication, no ordering subtlety.

### Q4 — durable surfacing of a failure

**Option A: log only.** ← selected
**Option B: also surface in the operator status view.**
- Cons: the only natural home for a per-feature record is the worktree — which this
  operation is in the act of deleting. Any durable surface therefore requires new
  engine-owned state outside the worktree, with its own lifecycle, staleness, and cleanup
  questions. That is disproportionate for a condition that blocks nothing and changes no
  feature state.

## Decision

**1. Contract.** The teardown runner mirrors `runProjectSetup` exactly: same executable
resolution, `cwd` set to the worktree, `all: true`, and `env: { CI: 'true', [NAMESPACE_VAR]:
namespace }` where `namespace` is recomputed by the same
`sanitizeNamespace(basename(worktreePath))` call. No marker file, ledger, or persisted state
is introduced (FR-2, FR-3). An absent script returns silently — and, unlike the setup side,
emits **no** log line at all, because FR-4 requires byte-identical log output for
non-adopting projects.

**2. Time bound.** `execa`'s `timeout` option, defaulting to **120 seconds**, overridable by
a new top-level `teardown_timeout_seconds` config key resolved in `resolved-config.ts`
alongside the existing `*_timeout_*` resolvers. The value must be a positive finite number;
a missing, non-numeric, non-finite, zero, or negative value falls back to the default and
logs one warning. **There is deliberately no way to disable the bound** — an unbounded
project script inside the daemon's critical path is the precise failure this ADR exists to
prevent, so opt-out is not offered even though the neighbouring `auth_park_timeout_minutes`
key treats zero as an opt-out signal. That divergence from the sibling key is intentional and
must be stated in the configuration reference.

**3. Placement.** Co-located with `runProjectSetup` in `worktree-prepare.ts`, exported
alongside it. The module docblock is updated to state that it owns **both** sides of the
project-script boundary, not preparation alone.

**4. Containment.** Every failure mode — non-zero exit, timeout, spawn error, missing execute
permission — is caught inside the runner and converted to a log entry. The runner's return
type carries no error and it never throws, so no caller needs a `try`/`catch` to be correct
(FR-6, FR-7). Reporting on the failure path carries the worktree path and a 50-line output
tail, reusing the existing tail helper (FR-8). On the success path, output is summarized to
one line and echoed in full only under the existing verbose daemon setting, matching the
setup side (FR-9).

**5. Invitation points.** Three, exactly (FR-5):
- `daemon-deps.ts` `teardownWorktree` — **after** the `keep === true` early return, so the
  two `daemon-runner` calls that retain a worktree for a human never run teardown. This is
  load-bearing: running teardown on a retained worktree would release the resources of a
  build a human is about to resume.
- `daemon-park-cli.ts` `reclaim-worktree`, before `removeWorktree`.
- `park-reconciliation.ts`, once, immediately before the removal attempt and inside the
  `worktreeOnDisk` guard — covering both the `git worktree remove` branch and the `rm -rf`
  fallback (Q3, Option C). When the path is already gone (`ENOENT`), teardown is skipped:
  there is no script left to run.

**6. Failure surfacing.** The operator log only. The failure and timeout entries carry a
stable, greppable prefix so an operator can audit leaks after the fact without new state.

## Consequences

**Positive**
- A project releases exactly what it acquired, under the identical identity, with one script
  and no bookkeeping on either side.
- No project-supplied code can wedge the daemon, stall an operator command, or strand a
  worktree — guaranteed structurally, because removal is reached on every branch.
- Non-adopting projects observe no change at all, including in log volume.

**Negative / accepted**
- A failing teardown still leaks. This is the deliberate cost of choosing containment over
  blocking; the leak is loud rather than silent, and FR-8's tail is what makes it
  diagnosable.
- A hung teardown adds up to the configured bound to the reap path. Bounded, and only on the
  pathological path.
- One new configuration key, one new documented convention, and a deliberate semantic
  divergence from `auth_park_timeout_minutes` regarding the meaning of zero.

**Follow-on**
- `autoresolve.ts:338` prepares a worktree and removes it without teardown, so it leaks
  identically. Excluded by operator decision; recorded as an explicit exemption under
  `adr-2026-08-07-worktree-removal-coverage-guard` and filed as separate work.
- Per `CLAUDE.md`, this is consumer-facing: `docs/reference/environment.md`,
  `docs/reference/configuration.md` (the new key), `docs/guides/running-the-daemon.md`,
  `docs/runbooks/worktree-and-evidence-recovery.md`, and `docs/contributing/testing.md` must
  be updated in the same PR.
