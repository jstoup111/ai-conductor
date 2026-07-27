# conductor

The TypeScript engine behind `conduct-ts`. It owns the SDLC step sequence, the gate loop, the build/ship
daemon, and the engineer idea→spec loop.

Documentation for this package lives in the repository's `docs/` tree, not here.

| Topic | Page |
| --- | --- |
| Module map, layering, entry points | [`docs/contributing/code-organization.md`](../../docs/contributing/code-organization.md) |
| Test tiers, isolation policy, how to run each suite | [`docs/contributing/testing.md`](../../docs/contributing/testing.md) |
| The integrity check suite | [`docs/contributing/validation.md`](../../docs/contributing/validation.md) |
| Semver, changelog, breaking surfaces, waivers | [`docs/contributing/releases.md`](../../docs/contributing/releases.md) |
| Adding a skill, step, gate, hook, or command | [`docs/contributing/extending.md`](../../docs/contributing/extending.md) |
| Every command and flag | [`docs/reference/cli.md`](../../docs/reference/cli.md) |
| Every config key | [`docs/reference/configuration.md`](../../docs/reference/configuration.md) |
| Step names, phases, enforcement | [`docs/reference/steps.md`](../../docs/reference/steps.md) |
| `.docs/` artifacts and `.pipeline/` state | [`docs/reference/artifacts.md`](../../docs/reference/artifacts.md) |
| How the engine, daemon, and operator fit together | [`docs/explanation/architecture.md`](../../docs/explanation/architecture.md) |

Runnable end-to-end scenarios exercising this engine: [`examples/README.md`](../../examples/README.md).

## Build liveness and completion

During a build retry loop, the attributed-task count is advisory routing and telemetry: it can
under-count work that landed without a `Task:` trailer. Commit movement during the same attempt is
the liveness authority, so a pinned count alone cannot classify a build as stalled. When a retry
budget exhausts after real work landed, `build_review` is the completion authority: it grades the
actual diff against the plan and can either pass the build forward or fail it back for remediation.

## Build and test

```bash
cd src/conductor
npm ci
npm run typecheck
npm run build       # node scripts/publish-engine.mjs — raw tsup is refused by design
npm test
```

Structural validation runs from the repository root:

```bash
bash test/test_harness_integrity.sh
```

Per-suite commands and the smoke-test opt-in gates are in
[`docs/contributing/testing.md`](../../docs/contributing/testing.md).

> This file was a 4,221-line parallel documentation tree that had drifted from the code. It described 16
> steps where the engine has 22, listed `ui/` modules that no longer exist, cited an
> `engine/build-review.ts` that was never there, and documented `npm run build` as `tsup` when the build
> refuses raw `tsup` by design. Its durable content now lives under `docs/`, single-owned. The full prior
> text is in git history.
