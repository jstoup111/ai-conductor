# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-11-22T22:12:24.296Z
Slug: late-gate-fixes-restack-the-whole-stack-every-repa
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-late-gate-fixes-restack-the-whole-stack-every-repa
Head SHA: 387bed5bf380b8c6c241ea9776f428036a1557c5
Halted at: 2026-11-22T04:57:30.053Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and every blocking finding is REMEDIABLE — a repair, not a decision — remediation did not route: structured-result-rejected: dispositions[2].boundTaskIds must not bind non-owner task rem-as-built-rem-asb-5; owner is rem-prd-audit-rem-S3.12; dispositions[3].boundTaskIds must not bind non-owner task rem-as-built-rem-asb-9; owner is rem-prd-audit-rem-S9.5; dispositions missing required reference prd-criterion:S3.12; dispositions missing required reference prd-criterion:S9.5; rejections: [{"gapId":"S3.12","disposition":"rem-prd-audit-rem-S3.12,rem-as-built-rem-asb-5","accepted":["rem-prd-audit-rem-S3.12"],"field":"boundTaskIds"},{"gapId":"S9.5","disposition":"rem-prd-audit-rem-S9.5,rem-as-built-rem-asb-9","accepted":["rem-prd-audit-rem-S9.5"],"field":"boundTaskIds"}]

Blocking findings:
as-built:ff499755-7ca2-4223-9fed-9c8c4688e079:1 (REMEDIABLE; adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 7): Verified, 99% confidence; prior dc238377:2 remains partially unresolved. Legal leaf parts are discarded by the event projection at src/conductor/src/engine/restack/restack-executor.ts:1148 and replay grouping at :1165. Every folded source is then omitted at :1173 and skipped during leaf replay at :949. A hunk only the leaf accepts is therefore lost from replay and reporting, causing tree-mismatch refusal instead of preservation. The former per-source owner-part restriction is resolved.; as-built:ff499755-7ca2-4223-9fed-9c8c4688e079:2 (REMEDIABLE; adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 8): Verified, 99% confidence; prior dc238377:3 remains unresolved. The fold journal draft at src/conductor/src/engine/restack/restack-executor.ts:1114 does not persist target cascade charges or placement route replacements. foldRoutes remains local at :1322, and charges are computed only in the normal applied path at :1432. Recovery at src/conductor/src/engine/restack/restack-recovery.ts:1315 uses appliedTransactionLines, whose writes at restack-executor.ts:403, :408 and :413 require those journaled fields. A moved/synced fold can therefore recover without marking placements placed or charging targets.; as-built:ff499755-7ca2-4223-9fed-9c8c4688e079:3 (REMEDIABLE; adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 7): Verified, 99% confidence; prior dc238377:4 remains unresolved. src/conductor/src/engine/restack/restack-executor.ts:1224 retains each placed commit SHA only as the accumulator tip; :1247 journals ordinary replay mappings, while :949 skips folded sources without mappings. src/conductor/src/engine/restack/restack-journal.ts:91 stores intended parts, not actual source-to-child-to-placed SHA correspondence. The required evidence translation and recovery correspondence is still absent.; as-built:ff499755-7ca2-4223-9fed-9c8c4688e079:4 (REMEDIABLE; adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 11): Verified, 99% confidence; prior dc238377:8 remains partially unresolved. Resolver execution context now exists at src/conductor/src/engine/restack/restack-resolver.ts:447 and is forwarded at src/conductor/src/engine/step-runners.ts:3122, but no matching resolver span is opened. src/conductor/src/engine/otel/span-manager.ts:278 cannot match that execution to the existing lifecycle span; its fallback at :331 annotates the run span at :347 and adds an event at :351. Fold and ordinary restack attempts therefore still lack the required attributed resolver span.
```
