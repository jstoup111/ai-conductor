# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-01T11:42:36.692Z
Slug: pi-per-step-model-selection-via-wrapped-providers
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-per-step-model-selection-via-wrapped-providers
Head SHA: 398a28dce524060448cd61e85afea9d34d0fa2fa
Halted at: 2026-10-01T07:12:12.700Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: AR-ASBUILT-9 (REMEDIABLE; adr-2026-07-03-reactive-model-fallback-ladder decision 8): Verified at 99% confidence: terminal provider/model exhaustion omits resolvedModel and resolvedEffort at provider-execution.ts:1182, so step-runners.ts:1877 and conductor.ts:11298 cannot place the failed Pi rung’s full provider/model id and effort on step_retry.; AR-ASBUILT-10 (REMEDIABLE; adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13): Verified at 98% confidence: Pi-selected build_review rubric and custom-rubric model_fallback_ladder entries are dispatched by resolved-config.ts:921 but provider-model-config.ts:76 collects only rubric.model, so those configured Pi ids bypass syntax validation and boot catalog probing.; AR-ASBUILT-11 (DESIGN; plan task 10): Verified at 97% confidence: Task 10 materially changed the scalar attribution ladder at attribution-lane.ts:357, but every production DefaultStepRunner root supplies providerExecution and therefore providerDispatch at step-runners.ts:2471. The changed scalar branch has no production caller; a human must decide whether to remove the legacy branch/obligation or establish a sanctioned production root.; AR-ASBUILT-12 (REMEDIABLE; plan task 11): Verified at 98% confidence: executeAuxiliaryProviderCandidates increments attempt but always supplies modelOverride and effortOverride at provider-execution.ts:1246, while resolved-config.ts:349 suppresses escalation when overrides exist. Pi auxiliary members therefore repeat their original model instead of using the configured mid model on attempt 3.; AR-ASBUILT-13 (REMEDIABLE; plan task rem-as-built-rem-ab7-1): Verified at 99% confidence: resolved-config.ts:349 now escalates every preferred candidate without overrides, not only Pi. The group path supplies attempt/escalate without overrides, so Claude validation-group retries change model and effort despite the sealed requirement that Claude runs without llm_providers retain pre-change escalation behavior.

Blocking findings:
AR-ASBUILT-9 (REMEDIABLE; adr-2026-07-03-reactive-model-fallback-ladder decision 8): Verified at 99% confidence: terminal provider/model exhaustion omits resolvedModel and resolvedEffort at provider-execution.ts:1182, so step-runners.ts:1877 and conductor.ts:11298 cannot place the failed Pi rung’s full provider/model id and effort on step_retry.; AR-ASBUILT-10 (REMEDIABLE; adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13): Verified at 98% confidence: Pi-selected build_review rubric and custom-rubric model_fallback_ladder entries are dispatched by resolved-config.ts:921 but provider-model-config.ts:76 collects only rubric.model, so those configured Pi ids bypass syntax validation and boot catalog probing.; AR-ASBUILT-11 (DESIGN; plan task 10): Verified at 97% confidence: Task 10 materially changed the scalar attribution ladder at attribution-lane.ts:357, but every production DefaultStepRunner root supplies providerExecution and therefore providerDispatch at step-runners.ts:2471. The changed scalar branch has no production caller; a human must decide whether to remove the legacy branch/obligation or establish a sanctioned production root.; AR-ASBUILT-12 (REMEDIABLE; plan task 11): Verified at 98% confidence: executeAuxiliaryProviderCandidates increments attempt but always supplies modelOverride and effortOverride at provider-execution.ts:1246, while resolved-config.ts:349 suppresses escalation when overrides exist. Pi auxiliary members therefore repeat their original model instead of using the configured mid model on attempt 3.; AR-ASBUILT-13 (REMEDIABLE; plan task rem-as-built-rem-ab7-1): Verified at 99% confidence: resolved-config.ts:349 now escalates every preferred candidate without overrides, not only Pi. The group path supplies attempt/escalate without overrides, so Claude validation-group retries change model and effort despite the sealed requirement that Claude runs without llm_providers retain pre-change escalation behavior.
```
