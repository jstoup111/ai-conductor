# Config-driven custom-step framework + build-start base-refresh instance

Status: Accepted
Track: technical
Tier: M

## Context (explore synthesis)

**Problem.** The daemon builds features on stale code bases and re-fails on already-merged
fixes: a feature's spec branch is cut off a `main` that `origin/<default>` has since advanced
past, and the only refresh is the SHIP-time `rebase` step (`engine/steps.ts:218` →
`Conductor.runRebaseStep`, `engine/conductor.ts:3799` → `performRebase`, `engine/rebase.ts:361`,
whose `resolveBase` already fetches `origin` and rebases onto `origin/<default>` — **not** local
main). The gap is TIMING: that rebase runs *after* the whole build, so (1) tasks build on a
stale base, and (2) the late rebase re-parents evidence-bearing commits — the direct cause of
judged-attribution `Evidence range: anchor is unreachable` failures (#535 / PR #593).

**Operator direction (supersedes the earlier boolean-flag revision).** Do NOT add a bespoke
build-start rebase step. Instead build a **general, config-driven custom-step framework**, then
wire the base-refresh as one instance in THIS repo's `.ai-conductor/config.yml`.

**What already exists (verified in source).** A partial custom-step mechanism is present:
- `StepConfig` (`types/config.ts:64`) already carries `after`, `skill`, `enforcement`,
  `hooks: { before, after }`, `gate`, `kickback_target`, `by_tier`.
- `buildStepRegistry` (`engine/steps.ts`) already splices `config.steps` entries into
  `ALL_STEPS` at the `after` position, inheriting the target's phase/loopGate.
- The validator (`engine/config.ts:368`) already requires `after` to resolve to a built-in or
  sibling custom and validates `enforcement` and `hooks` paths.
- `runWithHooks` (`engine/hooks.ts:46`) already runs before/after hooks around a step body.

**The three gaps this spec closes.**
1. Custom steps **require `skill:`** today — both `buildStepRegistry` (`if (!c.after || !c.skill)
   continue;`) and the validator (`Custom step "…" requires 'skill:'`) reject a skill-less step.
2. There is **no engine-native `action:`** concept for a deterministic, in-process step body.
3. `runWithHooks` **has zero callers** — hooks are validated but never executed; the hook/action
   dispatch is not wired into the step loop.

**Target schema (per operator).**
```yaml
steps:
  my-security-scan:
    after: writing-system-tests
    skill: .claude/skills/security-scan/SKILL.md   # optional
    enforcement: advisory
    hooks:
      before: scripts/setup-scan.sh
      after: scripts/teardown-scan.sh
```
A custom step declares an insertion point (`after:`) and EXACTLY ONE body:
- `skill:` — dispatch a SKILL.md (existing path), or
- `action:` — an engine-native deterministic action from a small in-engine registry, or
- **hook-only** — no `skill`/`action`, but a `hooks.before` script that IS the step body.
`hooks.before`/`hooks.after` may also wrap a `skill:`/`action:` body (setup/teardown).

**LOAD-BEARING DESIGN RECONCILIATION (must not be lost).** The base-refresh is a
**deterministic git/engine operation, not an LLM skill**, AND it must reuse the *in-process* TS
primitives `resolveBase`/`performRebase`/`runGatedRebaseResolution` to keep the gated `/rebase`
resolver, the CHANGELOG-only auto-resolve, and the fail-closed HALT. A detached bash
`hooks.before` script **cannot** call those in-process functions — it would reimplement rebase
in shell and silently lose the resolver + auto-resolve + fail-closed semantics. Therefore
base-refresh is specced as an **engine-native `action: base-refresh`**, NOT a hook script. The
generic hook-only path is ALSO specced (for arbitrary non-git deterministic steps like the
`security-scan` example), but base-refresh deliberately uses the engine-action path.

**Scope guards.** Custom steps exist only for the repo that declares them (opt-in `steps:` map;
empty for all consumers). The base-refresh action is daemon-gated (no-op when `!this.daemon`,
matching `runRebaseStep`). Conflicts fail closed (HALT → `/rebase`); no/unreachable origin →
clean no-op. Deterministic engine code, not an LLM step.

**Sibling — #598.** #598 = daemon running a stale **engine binary**; this = the **code base** the
build runs against. Same root cause, different layers/blast radius → **kept separate**,
cross-referenced. (The custom-step framework could later host a #598 remedy too, but the
engine-swap and worktree-rebase have different failure modes; do not fold.)

## Story 1 — A custom step declared in config.yml is spliced into the sequence at `after` (framework happy path)

As a project maintainer, when I declare a custom step under `steps:` with an `after:` target and
a body, the engine must insert it into the pipeline at that position for THIS repo only.

### Happy Path

- **Given** a repo whose `.ai-conductor/config.yml` declares `steps.my-step` with
  `after: writing-system-tests`, a valid body (`skill:` / `action:` / `hooks.before`), and
  `enforcement: advisory`,
- **When** `buildStepRegistry(config)` runs,
- **Then** `my-step` appears exactly once immediately after `writing-system-tests`, inherits that
  target's phase, joins the tail loop iff the target is a loop member (or per explicit `gate:`),
  and same-`after` siblings execute in config-file order,
- **And** a repo with no `steps:` map gets the stock `ALL_STEPS` sequence unchanged (no global
  or consumer-visible effect).

## Story 2 — Build-start base-refresh runs before any task via `action: base-refresh` (instance happy path)

As the daemon build loop for THIS repo, with the base-refresh custom step declared
(`after: plan`, `action: base-refresh`), the engine must fetch origin and rebase the feature
worktree onto `origin/<default>` before the first BUILD-phase step dispatches.

### Happy Path

- **Given** this repo's `.ai-conductor/config.yml` declares
  `steps.build-start-base-refresh: { after: plan, action: base-refresh, enforcement: structural,
  gate: false }`, and a daemon run whose branch was cut off a now-stale `main`,
- **When** the pipeline reaches the inserted step (between `plan` and `acceptance_specs`/`build`),
- **Then** the engine runs the `base-refresh` action — `discoverLocalBase` → `resolveBase`
  (fetch origin, discover default) → `performRebase` onto `origin/<default>` — HEAD becomes a
  descendant of `origin/<default>`, and only THEN is the first build task dispatched, so all
  evidence commits are authored on the already-rebased base (removes the #535 anchor-unreachable
  churn; the ship-time `rebase` is then a `noop` unless something merged during the build).

## Story 3 — A skill-less (action or hook-only) custom step is valid and runs its body (negative path vs. today's skill-mandatory)

As the framework, a custom step with an `action:` or a `hooks.before` body but **no `skill:`**
must be accepted and executed — reversing today's "custom step requires skill" rejection.

### Negative Path

- **Given** `steps.x` with `after: plan` and either `action: base-refresh` OR only
  `hooks.before: scripts/foo.sh` (no `skill:`),
- **When** config validation and `buildStepRegistry` run,
- **Then** the step is accepted (not rejected for missing `skill`), inserted at `after`, and at
  dispatch the engine runs the engine-action (for `action:`) or the before-hook as the body (for
  hook-only) — exit 0 → step satisfied; non-zero → failure handled per `enforcement`,
- **And** a custom step declaring **no** body at all (no `skill`, no `action`, no `hooks.before`)
  is rejected by the validator with a clear "custom step needs a skill, action, or before-hook"
  error, and a step declaring more than one body is rejected as ambiguous.

## Story 4 — A build-start rebase conflict fails closed to the gated /rebase resolver (negative path)

As the daemon, when the `base-refresh` action cannot rebase cleanly, the engine must never build
a half-merged tree.

### Negative Path

- **Given** the `base-refresh` action whose `performRebase` returns `conflict_halt`,
- **When** the step runs,
- **Then** the engine invokes `runGatedRebaseResolution` (the same `rebase_resolution_attempts`
  cap the ship-time step uses) and, if unresolved, writes `.pipeline/HALT` leaving the rebase
  paused for the operator's `/rebase` skill — **no build task is dispatched**,
- **And** a lone CHANGELOG `[Unreleased]` conflict still auto-resolves (`performRebase`'s
  `changelog_resolved`), and this fail-closed HALT holds even though the step's declared
  `enforcement` is not `advisory` — an intrinsic conflict HALT is never downgraded.

## Story 5 — No/unreachable origin and non-daemon runs are a clean no-op (negative path)

As the `base-refresh` action outside a live daemon-with-origin context, it must complete without
HALTing and without touching a live checkout.

### Negative Path

- **Given** the action fires but `this.daemon === false` (interactive `/conduct` or the vitest
  suite), OR the repo has no `origin` remote, OR `git fetch origin` fails (offline),
- **When** the action runs,
- **Then** it degrades to a `noop` (the `!daemon` guard mirrors `runRebaseStep`;
  remote-less/failed-fetch uses `performRebase`'s existing local-base/no-op fallbacks), records
  no HALT, and the build proceeds — base-refresh is best-effort correctness, not a hard
  dependency, and it never corrupts an interactive/test checkout.

## Story 6 — Invalid `after:` targets and insertion cycles are rejected at config load (negative path)

As config validation, a custom step pointing at a nonexistent step, or a set of sibling customs
that reference each other cyclically, must fail loudly at startup — not silently vanish.

### Negative Path

- **Given** `steps.x.after: no-such-step`, OR two customs `a.after: b` and `b.after: a` (a cycle),
- **When** the config is validated at daemon startup,
- **Then** validation returns a clear error (`unknown after target` / `custom-step cycle detected:
  a → b → a`) and the daemon refuses to start that build rather than silently dropping the step
  (today an unresolvable/cyclic chain is quietly skipped by `buildStepRegistry`'s iterative pass),
- **And** a valid `after:` that names a sibling custom earlier in the chain is still accepted
  (multi-custom chains keep working).
