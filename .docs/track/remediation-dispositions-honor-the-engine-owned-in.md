# Track: Remediation dispositions honor the engine-owned input/output contract

Track: technical

Source: jstoup111/ai-conductor#2522

Scope boundary: Migrate the `remediate` step's gap-plan boundary onto one bounded, versioned, engine-owned input projection and one native schema-constrained, engine-validated, engine-persisted typed disposition collection for every `planRemediation` source. Full structural-reference accounting (missing, duplicate, foreign, malformed references and unknown dispositions rejected per field) applies to the typed sources — PRD-audit FIXABLE criteria and as-built REMEDIABLE findings, whose ids become engine-stamped. Untyped sources (finish-verification `test:<stem>`, build-stall `stall:<slug>`) are projected by their existing keys and validated against the same schema and vocabulary, without new identity schemes. Preserve existing routing, budget, operator-authority, concrete-work, idempotence, and #2187 rejection-diagnostic behavior; strip remediation format/vocabulary prose from `skills/remediate` with a reintroduction guard while keeping the skill interactively usable; Claude and Codex parity. Out of scope: combined routing/budgets (#2060), finding history (#2440), cross-gate reconciliation (#2441), rubric contracts (#2384), the generic step-contract platform (#191), and the existing PRD-widening reconciliation and build_review case-v1/v2 adjudication modes of `remediate` (separate contracts and readers outside `planRemediation`).

The operator selected scope option 3 (one native contract for all sources; full accounting only for typed sources) and approach A (reuse the shipped #2188/#2521 projection → native-schema dispatch → validator → engine store pattern) on 2026-10-06, and confirmed the technical track. Approach B (per-dispatch enum-constrained reference slots) is carried as an option for architecture review, not a separate approach; approach C (strict reader without native schema) was rejected because it leaves the wire format in skill prose and misses the native-output outcome.

Scope check: consumer-facing shared engine and shipped skill (`skills/remediate`); no new skill or registration; provider-agnostic contract over the existing native-schema seam.

## Verified basis

- `remediate` dispatches through `executeProviderAwareSkillOneShot` without `nativeSchema` for gap planning (`step-runners.ts` ~1465-1493); only the PRD-widening `remediationRequest` mode passes a schema.
- `readRemediationPlanResult` (`artifacts.ts` ~4686) is a tolerant mtime-gated reader with one production consumer (`Conductor.planRemediation`); disposition vocabulary is defined in code (`artifacts.ts` ~4555-4623) and duplicated in `skills/remediate/SKILL.md` §3–§4.
- `skills/remediate/SKILL.md` contradicts itself on as-built keys (§2 finding id vs §4 ADR stem), consistent with the #2188 exact-match halts (`conductor.ts` ~5344-5384).
- As-built finding ids are provider-minted free strings (`as-built-contract.ts` ~234), not structural; PRD-audit `criterionId` is engine-resolved.
- #2521 and #2188 are closed. The issue's "#2429 shared provider support" reference resolves to the shipped `InvokeOptions.nativeSchema` / `nativeSchemaCapability` seam; the current #2429 issue title concerns widening-approval drift, so the number is cited only as the seam's historical owner.
- No partial #2522 work exists on main or the spec branch.

Verify-claims: CLEAR for the selected approach and track. Contract details (id stamping point, store shape, enum-slot option) remain subject to architecture approval.
