# Retro: OTel Observability — Phase 1
**Date:** 2026-06-29 | **Stats:** 22 tasks, 3 batches, 2 rework cycles (1 build, 1 prd-audit), 0 unplanned human interventions, 2004 tests passing

## Part A: Harness

- **H-1 (Gate quality — false negative, HIGH):** FR-8's warning callback was unwired in production (`index.ts` constructed `OtelVisualizer` without `onWarning`) — an orphaned primitive that passed **all three** code-review evaluators, including the final Opus one that explicitly checked `production_wired` and returned `true`. The evaluator's orphaned-primitive check verifies **component-level** instantiation ("is the visualizer started in the live path?") but NOT **constructor-argument-level** wiring ("is every design-required option/callback actually passed at the production construction site?"). Caught only by prd-audit's intent-vs-shipped-wiring lens. → Fix: extend the orphaned-primitive check in `agents/evaluator.md` (code-review) AND the real-entry-point rule in `skills/writing-system-tests/SKILL.md` §3b/§3d to require: for any design-mandated optional argument (callback, option, flag) whose absence silently disables a behavior, a test must drive the REAL production construction and assert the behavior fires — not just that the component starts.
- **H-2 (Correctness — typed surface that silently misbehaves, MED):** `protocol: 'grpc'` was a valid type-union value but `buildExporters` ignored it and silently returned HTTP; no test exercised the gRPC branch. Caught at the batch-1 evaluator (gate worked), but `writing-system-tests` should have required a case per discriminated-union config value. → Fix: add a negative-path category to `skills/stories/SKILL.md` / a check in `writing-system-tests`: "every enumerated config/discriminated-union value must have a test exercising its distinct branch; an accepted-but-unhandled value is a dead-config defect."
- **H-3 (Autonomy):** No issues — the two rework cycles were gate-driven and self-resolved within budget; the one product/scope decision surfaced (phasing, gRPC-vs-defer) was a legitimate design choice, not a preventable intervention.

**Proposed changes:**
- [ ] H-1: extend orphaned-primitive check to constructor-argument-level wiring (evaluator + writing-system-tests). **Recurring class — see Trends.**
- [ ] H-2: dead-config-value coverage rule in stories/writing-system-tests.

## Part B: Application

- **A-1 (Debt, MED):** `OtelVisualizer.stop()` calls `forceFlush()` only, never `shutdown()` — production code shaped by a test concern (preserving `InMemorySpanExporter` data). Safe now (process exits after stop), but if the visualizer is reused in a long-lived host (the future SSE dashboard, issue tracked), real OTLP sockets won't be released. → Story: gate `shutdown()` behind a non-test flag before any long-lived reuse.
- **A-2 (Debt, LOW):** File span+metric exporters interleave into the same `.pipeline/otel.jsonl` by default. Fine for offline ingestion; revisit if a consumer needs separated streams. → Note on issue #135/#136, no story yet.
- **A-3 (Debt, LOW):** `onWarning` is a plain string bridged to `renderer_error`; the event carries no structured error category/severity. → Follow-up if observability-of-the-observability is ever needed.

**Proposed changes:**
- [ ] A-1: new story (Phase 2 / SSE) — `shutdown()` gated by non-test flag for long-lived hosts.

## Part C: Context Efficiency

- **C-1 (saving realized):** prd-audit was run as **1 consolidated Opus auditor** instead of the skill's prescribed 10 per-FR dispatches (~9 dispatches saved) — and still caught the FR-8 critical. → Propose `skills/prd-audit/SKILL.md` allow an explicit single-auditor mode for cohesive single-module features, with the caveat that per-FR scoping lowers rubber-stamp risk for sprawling features.
- **C-2 (saving missed):** The SHIP tail ran 3 Opus dispatches (final evaluator, prd-audit, re-audit). The **re-audit** was a narrow 2-FR fix verification that Sonnet would have handled. → Propose: targeted re-review/re-audit after a scoped fix downgrades to Sonnet.
- **C-3 (friction):** `rtk` vitest passthrough failed to parse repeatedly, forcing `--reporter=json --outputFile` workarounds. Minor tooling friction, not a skill defect.

**Proposed changes:**
- [ ] C-1: single-auditor mode option in prd-audit SKILL.md.
- [ ] C-2: Sonnet for post-fix targeted re-audit/re-review in pipeline + prd-audit.

## Trends
- **Orphaned-primitive class is recurring and evolving.** Prior occurrences (Phase-9 features, per `[[feedback_orphaned_primitives]]`) were component/symbol-level (new primitive, zero production callers). This run is the **constructor-argument-level** variant (component IS wired, but a required option isn't passed). The existing greps + evaluator check don't reach it — H-1 is the needed extension. Escalate: this class has now escaped at two distinct granularities; the real-entry-point rule should explicitly enumerate both.
