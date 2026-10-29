Waives: outcome-4, outcome-5

Rationale: Both outcomes of jstoup111/ai-conductor#3333 are delivered, but neither through a story or plan task.

- **outcome-4** (docs and the configuration reference no longer describe an in-process mode or rollback lever): Documentation is not authored as stories or plan tasks in this repository. HARNESS "Docs track features" requires the BUILD diff to update `docs/reference/configuration.md`, `docs/runbooks/daemon-recovery.md`, `docs/guides/running-the-daemon.md`, `docs/guides/self-hosting.md` and `docs/reference/artifacts.md`, including retargeting their `#executor_isolation` anchor links. The `finish` step verifies the docs reflect what shipped. The shipped config template block is removed by plan Task 9, because `config-template.test.ts` enforces it.
- **outcome-5** (the ADR's follow-up action is marked done): Done during this DECIDE pass. The spec's amendment commit to `adr-2026-10-15-per-dispatch-engine-pinned-executor` ticks the Follow-up Actions item and adds a 2026-10-24 amendment note, so no build work remains.
