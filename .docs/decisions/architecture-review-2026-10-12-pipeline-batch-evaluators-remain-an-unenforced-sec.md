# Architecture Review: Pipeline batch evaluators remain an unenforced second review authority
**Date:** 2026-10-12
**Stories reviewed:** `.docs/stories/pipeline-batch-evaluators-remain-an-unenforced-sec.md` Stories 1–8. The pass started before stories and was re-opened in amendment mode when conflict-check found the closeout-telemetry dependency.
**Mode:** Full (Large tier)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** No new packages, services, or infrastructure. Every change is a deletion, a narrowed union,
  a flipped default, or one added diagnostic reason inside existing modules. Verified (95%) by reading each site.
- **Prerequisites:** The replacement review authority is on main. #3086 shipped the default-on `implementationQuality`
  rubric, and `prd_audit` owns acceptance-criteria compliance (adr-2026-08-22-one-owner-per-review-question D1). The
  `security` rubric's registry entry, dispatch, leaf-only stacked grading, cache, and adjudication already ship, and this
  repository enables them explicitly in `.ai-conductor/config.yml`. Only the default changes (`resolved-config.ts`
  default-enabled map, `security: false` → `true`). Verified (95%).
- **Integration surface (Stories 2, 7, 8):** The closeout channel touches these sites:
  - **Event types:** `types/events.ts` (two kinds) and `engine/event-sinks.ts` (two registry rows).
  - **CLI:** `index.ts` (dispatch), `engine/closeout-cli.ts`, and `engine/closeout-trust.ts`.
  - **OTel:** `engine/otel/metrics.ts` (histogram and handler), `metrics-listener.ts`, `span-manager.ts`, and
    `otel-visualizer.ts`.
  - **Output:** `ui/terminal-renderer.ts` and `daemon-cli.ts` (log lines).
  - **Build-tail:** `engine/build-tail-rollup.ts` and `engine/build-tail-cli.ts`.
  - **Sessions:** `execution/daemon-session.ts` (allowlist).
  - **Ledger types:** `engine/closeout-events.ts` (type aliases; the writer survives).

  Verified (95%) by grep for `pipeline_closeout`, `closeout-trust`, and `closeout-cli`. This crosses more than three
  module boundaries, all inside the conductor package. That is why the tier is Large.
- **Live dependents that must survive (verified 95%):** `build-review-cli.ts` and `kickback-budget-cli.ts` write
  external events through `closeout-events.ts`. `event-persister.ts` starts `CloseoutEventTail`. Report readers use
  `readMergedFeatureEvents`. adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry decision 2 keeps all of them.
- **Data implications:** No destructive migration.
  - **Engine ledger:** `pipeline_closeout*` events were registered `persist: false` (`event-sinks.ts`), so the engine
    ledger `.pipeline/events.jsonl` holds none, and replay is unaffected.
  - **Sibling ledger:** `.pipeline/pipeline-events.jsonl` in existing worktrees may hold closeout records. The tail's
    new admitted-type check (decision 3) turns them into `unadmitted-type` diagnostics instead of undeclared bus events.
  - **Rollup:** the build-tail rollup ignores them (decision 4).
- **Performance risk:** Net reduction. Batch-boundary evaluators were the largest single token line item in the
  2026-04-17 Medium run. The security default adds one `high`-effort rubric per consumer build (see Risks).
- **Worktree isolation:** No ports, databases, or shared resources. The sibling ledger stays per-worktree.
- **Version-skew window (operator-accepted):**
  - **Why it exists:** `bin/ai-conductor` resolves the floating `dist` link on every call (verified 95%). After a
    rebuild, a session still running old `/pipeline` text calls a `closeout-event` that no longer exists. The command
    falls through to the CLI's generic `error: unknown command` exit 1 (verified 90%, `index.ts` bare-command
    fallthrough).
  - **Effect:** the old text then blocks that batch.
  - **Recovery:** the existing halt and re-dispatch path loads the new skill text.
  - **Accepted:** no transitional tolerance and no note. The daemon's own self-heal rebuild runs only at idle
    boundaries (inferred 80%, `docs/runbooks/daemon-recovery.md`).

## Complexity

| Story | Level | Note |
|---|---|---|
| 1 Batch boundary | Low | Prose and two shell contract tests |
| 2 Closeout channel retired | High | 4+ modules, consumer-visible CLI and metric removal |
| 3 Single review authority | Low | Prose and one integrity scan |
| 4 Security default-on | Medium | One literal; default-config fixtures move with it (the #475 precedent needed e2e opt-outs) |
| 5 Model routing | Low | Metadata row and regenerated tables |
| 6 Personas and templates | Low | Prose |
| 7 Tail admitted types | Medium | One check plus a diagnostic reason; event-union change |
| 8 Rollup reshape | Medium | Type narrowing and state-machine edit, plus CLI output |

No spike is needed. Splitting into features was considered and declined by the operator (fold-in chosen during conflict-check).

## Alignment

- **Governing ADRs reused:**
  - **adr-2026-08-22-one-owner-per-review-question D1:** the batch evaluator was an unmapped second owner; retiring it
    conforms to D1.
  - **adr-2026-08-13-stable-build-review-finding-dispositions decision 5:** the tail carries *allowlisted* external
    events, and decision 3 of the new ADR makes that mechanical.
  - **adr-2026-08-08 D2:** the single-writer sibling ledger stays.
- **New ADR (APPROVED by the operator 2026-10-12):** adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry,
  decisions 1–5. It passes the §7 structural prerequisite because it retires event kinds and a CLI primitive from the
  state and event architecture, and it changes the sibling ledger's admitted-type boundary.
- **On-main ADR amendments (additive notes):**
  - **adr-2026-08-08-pipeline-owned-closeout-timestamps:** D1, D3, and D4's closeout timeline are superseded; D2 stays
    in force.
  - **adr-2026-08-26-remove-retrospectives-one-shot decision 3:** the closeout roster is gone entirely.
  - **adr-2026-08-22-build-review-opt-in-rubric-container decision 1:** security is default-on.
  - **adr-2026-08-22-one-owner-per-review-question D1:** batch evaluator retired; security owner default-on.

  None of these is wholly superseded, so each keeps `Status: APPROVED`.
- **Event spine:** No parallel channel is added. The change removes two kinds from the one `ConductorEvent` union. It
  extends an existing kind's closed reason set (`pipeline_tail_diagnostic.reason` gains `unadmitted-type`) rather than
  inventing a new event.
- **Pattern consistency:**
  - **Precedents followed:** the earlier retirements, adr-2026-08-14 (wiring rubric) and adr-2026-08-26 (retrospectives):
    remove the capability and every reference in one feature, and keep the shared persona a surviving caller uses.
  - **Survivors kept:** `agents/evaluator.md` stays for `/code-review`. The closeout-named ledger modules
    (`closeout-events.ts`, `closeout-tail.ts`, `CloseoutEventTail`) keep their names, because a rename is a separate
    refactor (track exclusion).
- **Directory deletion:** None. Only files are deleted (`closeout-cli.ts`, `closeout-trust.ts`, and their tests), so the
  two-feature split rule in `CLAUDE.md` does not apply.
- **Release gate:** Removing `closeout-event` touches the canonical `bin/conduct CLI` surface with a real behavior
  change, so the PR carries a `## Migration` fence (ADR decision 5). A waiver is not allowed.
- **State management:** The rollup's `partial` variant loses its optional `closeout` payload, and `BuildTailRollup`
  remains a closed discriminated union (`measured | partial | unavailable`). No boolean flags are introduced.
- **Security boundaries:** The tail's admitted-type check closes a gap: an arbitrary well-formed line in the sibling
  ledger could previously put any event kind onto the live bus. No new endpoint or input surface.
- **Production DI defaults:** Unchanged. No in-memory store is introduced.
- **Skill and instruction text to correct (Stories 1, 3, 6):**
  - **Pipeline:** `skills/pipeline/SKILL.md`.
  - **Gate-satisfaction claims:** `skills/conduct/SKILL.md` and `skills/architecture-review/SKILL.md` (§7b
    "Pipeline evaluators…", §9 "Evaluator checks at code review").
  - **Code review:** `skills/code-review/SKILL.md` (batch-scoping sentence).
  - **Harness:** `HARNESS.md` and `templates/AGENTS.md.template`.
  - **Agents:** `agents/generator.md`, `agents/domain-reviewer.md`, `agents/cto-testing.md`, and
    `agents/cto-architecture.md`.
  - **Authoring skills:** `skills/writing-system-tests/SKILL.md`, `skills/stories/SKILL.md`, and the
    `skills/conflict-check/SKILL.md` example.
- **Diagrams:** `.docs/architecture/pipeline-batch-evaluators-remain-an-unenforced-sec.md` is updated to show the
  retired closeout channel, the surviving sibling ledger, and the tail's admitted-type check.

## Domain Integrity

- **Closed unions stay closed:**
  - **Event union:** narrows by removal, so impossible kinds become uncompilable (Story 2 negative path).
  - **Diagnostic reason set:** gains one literal and no catch-all.
  - **Admitted-type set:** derived from the existing `ExternalPipelineEvent` type list (Story 7 Done When), not a
    hand-copied string list. It is one source of truth for writer and tail.
- **Exhaustive matching:** Renderer, daemon-log, OTel visualizer, and sink-registry switches over `ConductorEvent` lose
  their `pipeline_closeout` arms. The event-sink registry is keyed by every union member, so a stale arm or a missing
  row fails compilation. Inferred (85%) from the `satisfies`-style registry in `event-sinks.ts`.
- **No primitive obsession introduced:** No new identifiers, statuses, or money.

## Wiring Surface

New production surfaces:
- **`unadmitted-type` diagnostic:** emitted by the existing `CloseoutEventTail.pollOnce` inside the tail started by
  `event-persister.ts`. It is rendered and persisted through the existing `pipeline_tail_diagnostic` sink row.
- **Security default:** the `security: true` default is read by the existing resolved-config default map and
  classified by the existing build_review registry dispatch.

Surviving surfaces whose callers stay:
- **External-event writer:** `appendCloseoutEvent` is still called by `build-review-cli.ts` and `kickback-budget-cli.ts`.
- **Tail:** `CloseoutEventTail` is still started by `event-persister.ts`.
- **Merged reader:** `readMergedFeatureEvents` is still called by the build-tail rollup and build-review metrics.
- **Build-tail command:** `build-tail` is still dispatched by `index.ts` through `detectBuildTailCommand`.
- **Evaluator persona:** `agents/evaluator.md` is still dispatched by `skills/code-review/SKILL.md`.
- **Model-table row:** the `evaluator` row is still rendered by the model-table generator.

Removed surfaces, which must have no remaining production caller after BUILD:
- **Pipeline review machinery:** the `/pipeline` evaluator dispatch and the `review.json` / `code-review-satisfied.md`
  writes.
- **CLI:** the `closeout-event` subcommand, `closeout-cli.ts`, and `closeout-trust.ts`.
- **Event kinds:** `pipeline_closeout_started` and `pipeline_closeout`.
- **OTel:** the `conductor.pipeline.closeout.duration` instrument and the `pipeline_closeout` span event.
- **Build-tail:** the rollup's closeout window field and closeout-bearing `partial`.

Early overlap scan (advisory, run 2026-10-12 over the instruction and closeout paths): `skills/conduct/SKILL.md`
overlaps `origin/spec/per-step-provider-routing-927`. No other overlap was reported for the paths scanned.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| In-flight build on old skill text blocks after a mid-run engine rebuild | Technical | Low | Medium | Accepted by the operator; the existing halt and re-dispatch path reloads the new skill text |
| Default-on security adds a `high`-effort judgement to every consumer build | Performance | High | Medium | Operator-chosen; `rubrics.security.enabled: false` or a lower effort opts down |
| Dashboards charting `conductor.pipeline.closeout.duration` go empty | Integration | Medium | Low | Release note and migration fence name the retired metric |
| A removed export is still imported by a test or module the grep missed | Technical | Medium | Low | The TypeScript build and suite fail closed; Story 2 Done When requires no importer |
| Default-config build_review fixtures break on the security flip | Technical | High | Low | Story 4 Done When; the #475 precedent opted fixtures out or stubbed graders |
| Over-deletion removes the live sibling ledger or tail | Data | Low | High | ADR decision 2; Story 7 happy paths prove build-review and kickback events still re-emit |
| A surviving doc or test still asserts an evaluator gate | Integration | Medium | Low | Stories 1, 3, and 6 integrity scans |

## ADRs Created

- adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry (APPROVED 2026-10-12).

Amended (additive notes, on main): adr-2026-08-08-pipeline-owned-closeout-timestamps (D1–D4),
adr-2026-08-26-remove-retrospectives-one-shot (decision 3), adr-2026-08-22-build-review-opt-in-rubric-container
(decision 1), and adr-2026-08-22-one-owner-per-review-question (D1).
