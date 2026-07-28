# Conflict Check — Feature-aware step artifact resolution (#993)

**Result:** PASS (zero blocking or degrading conflicts; seven coexistence constraints recorded)

The full story, active-spec, and prior-conflict corpus was scanned for contradiction,
behavioral overlap, state conflict, resource contention, and sequencing conflict. The four
new stories are complementary: TS-993-1 defines the contract, TS-993-2 defines resolution,
TS-993-3 migrates generic consumers, and TS-993-4 preserves stronger existing behavior.

## Relevant adjacent work

| Existing work | Interaction | Verdict | Confidence |
|---|---|---|---:|
| Idea-scoped land artifact resolution (#488) | Uses branch change sets and untracked `.docs` files to attribute artifacts | Complementary precedent; no module dependency required | 96% |
| Session-fresh verdict artifacts (#649) | Custom predicates impose attempt/session freshness beyond file existence | Preserved by TS-993-4 | 98% |
| Gate completion validates code state (#817) | Custom judged-gate predicates validate semantic and code-state evidence | Preserved by TS-993-4 | 98% |
| Maintain-documentation completion | Configured exact artifact and freshness checks precede generic discovery | Preserved by TS-993-4 | 97% |
| Acceptance-spec RED self-heal (#733) | Configured globs and a stronger RED predicate govern completion | Preserved by TS-993-4 | 97% |
| Judged attribution / build completion (#773) | Custom build predicate owns its evidence contract | Outside generic resolver authority | 97% |
| Feature-bound artifact freshness (ADR #971) | Explicitly deferred coherence's unscoped glob behavior to #993 | Compatible; this work closes that deferred scope gap | 99% |

## Coexistence constraints for the implementation plan

**C1 — Custom completion predicates remain authoritative.** Inventory
`CUSTOM_COMPLETION_PREDICATES`; the shared resolver may support their discovery but must not
replace their semantic, freshness, or code-state checks.

**C2 — Configured completion artifacts retain exact-file freshness behavior.** The existing
configured path and freshness branch remains ahead of generic contract resolution.

**C3 — Acceptance-spec configuration and RED validation remain intact.** Project-declared
acceptance globs stay eligible, while their stronger predicate remains the completion authority.

**C4 — Prior verdict-validity invariants compose unchanged.** The feature resolver neither
relaxes attempt/session freshness nor bypasses gate-code validity from #649 and #817.

**C5 — Change-set attribution is reused as a rule, not coupled to the engineer module.** The
resolver lives in `engine/artifacts.ts` and consumes repository state through an engine-owned
boundary so no engineer-to-engine dependency or cycle is introduced.

**C6 — Phase ownership remains unchanged.** This work closes the generic feature-selection gap
deferred by ADR #971; it does not redefine coherence freshness or any step's completion semantics.

**C7 — Raw corpus discovery remains available.** `findArtifactFiles` remains policy-free for
explicit corpus callers. Generic completion, interactive review, and dashboard status migrate to
the shared feature-aware resolver together.

## Pairwise result

No new-story pair asserts incompatible behavior or ownership. The only sequencing requirement is
implementation order: contract declaration before resolver, resolver before consumer migration,
with the preservation suite spanning all tasks. No conflict resolution or ADR amendment is needed.

