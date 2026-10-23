# Complexity: Done-when `[test]` checks close as verified citing tests that don't assert the check (#3200)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | A task start HEAD on the task-status row; a pending-judgement close record; a judged close source beside `verified` / `reported` / `verify-only` / `unverified`; an operator citation-acceptance record |
| External integrations | None — the judge reuses the existing native-schema provider dispatch (`InvokeOptions.nativeSchema`, as `prd_audit` and plan_review use) |
| Auth / permission surface | One operator-only CLI command (`ai-conductor done-when accept`) |
| State machines | One bounded loop inside BUILD: pending citation → judged → (asserts: closed) or (does-not-assert: task reopened, refusal count +1) → at the bound (second refusal or last attempt) demoted to `unverified`; operator acceptance overturns any refusal. No new step, halt class, or lap |
| Story count | 8 (start commit, mechanical verified close, pending close, boundary judgement, bounded reopen and demotion, judge outage, operator acceptance, events); 18 plan tasks |
| Files touched | Engine: `task-cli.ts`, `task-progress.ts`, `done-when-test-reference.ts`, `artifacts.ts` (BUILD completion), `conductor.ts` (boundary dispatch), `step-runners.ts` / a new pure judge module, `types/events.ts`, `event-sinks.ts`; skills: `pipeline`; docs: CLI reference, gates explanation, runbook |
| New runtime code | Yes — task-close evidence semantics and one engine-dispatched judgement |

## Rationale

Changes the evidence rule at BUILD task close and adds one bounded, schema-constrained judgement at
the BUILD-completion boundary, amending the APPROVED
`adr-2026-08-22-done-when-evidence-at-task-close` (D6 text-only verification, D7 refusal handling,
the closed close-record `source` set). Every piece has an in-repo analog: start/close bookkeeping in
`task-cli.ts`, the one-nudge-per-lap BUILD completion hook for unverified checks
(`unverifiedDoneWhenNudgeCompletion`), native-schema judgement dispatch (`prd_audit`, plan_review),
and the bounded-judge-plus-operator-lever pattern from
`adr-2026-10-10-source-grounded-adversarial-plan-review-step` D6. One repo, no new step, no new halt
class, no persisted format outside `.pipeline/`, no directory deletion. Needs a lightweight
architecture review for the ADR amendment and the judge placement. Not Large: no cross-repo surface,
no new infrastructure, no migration of committed state. → **Medium.**
