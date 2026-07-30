# Coherence: Contract-aware same-file wiring

Plan stem: `wiring-gate-flags-production-reachable-seams-compo`. Tier M, technical track; the `fr` row class is omitted because this track has no PRD. Outcome 1 reflects the operator-approved 2026-07-30 refinement: the exception requires the declared caller contract, exact symbol identity, and production-root reachability together. Outcome 4 is resolved by accepting same-file contracts under that rule and deterministically retaining a named gap when proof is missing or mismatched.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | Story 1 requires all three approved proofs and removes only the qualifying same-file orphan gap. |
| outcome | outcome-2 | story-2 | covered | Story 2 keeps a dead helper in a production-reachable module as an `orphan-export` gap. |
| outcome | outcome-3 | story-2, story-3 | covered | Story 2 denies test-only root chains; Story 3 preserves the existing Layer 1 test-only gap. |
| outcome | outcome-4 | story-1 | covered | Story 1 accepts the existing `path#caller` grammar only when the caller resolves exactly and retains an actionable named gap for absent or mismatched proof. |
| story | story-1 | task-1, task-2, task-3, task-4, task-9, task-10, task-13, task-16 | covered | These tasks type and validate proof, classify candidates, join the three facts, integrate evidence, and exercise the qualifying boundary. |
| story | story-2 | task-3, task-6, task-7, task-8, task-12, task-17 | covered | These tasks prove exact symbol identity and preserve dead, test-only, lexical-lookalike, and shadowing failures. |
| story | story-3 | task-5, task-11, task-13, task-14, task-17 | covered | These tasks bound compiler work, deny unavailable Layer 2 states, preserve legacy paths, and exercise unsupported cases. |
| story | story-4 | task-15, task-16, task-17 | covered | These tasks align the as-built contract and verify BUILD/SHIP agreement for qualifying and stale/unreachable cases. |
| task | task-1 | story-1 | covered | Defines the typed proof required by Story 1. |
| task | task-2 | story-1 | covered | Makes malformed Story 1 proof fail closed. |
| task | task-3 | story-1, story-2 | covered | Preserves the root chain required by both the qualifying and test-only distinctions. |
| task | task-4 | story-1 | covered | Classifies same-file candidates without prematurely passing them. |
| task | task-5 | story-3 | covered | Enforces one shared TypeScript analysis context per run. |
| task | task-6 | story-2 | covered | Resolves the exact caller-to-export symbol reference. |
| task | task-7 | story-2 | covered | Excludes comments, strings, declarations, and imports from proof. |
| task | task-8 | story-2 | covered | Rejects shadowed same-name bindings. |
| task | task-9 | story-1 | covered | Joins ownership, exact caller identity, and production reachability. |
| task | task-10 | story-1 | covered | Denies missing and mismatched caller contracts. |
| task | task-11 | story-3 | covered | Keeps unavailable Layer 2 states fail closed. |
| task | task-12 | story-2 | covered | Keeps dead helpers and test-only paths blocked. |
| task | task-13 | story-1, story-3 | covered | Integrates typed proof while preserving legacy evidence behavior. |
| task | task-14 | story-3 | covered | Verify-only task pins unchanged cross-file and legacy paths. |
| task | task-15 | story-4 | covered | Aligns SHIP's independent as-built reachability contract. |
| task | task-16 | story-1, story-4 | covered | Proves the #880 qualifying path through the completion boundary. |
| task | task-17 | story-2, story-3, story-4 | covered | Proves false-pass, unsupported, and stale-evidence cases through the boundary. |

All 25 applicable rows are covered; zero gaps. Verdicts were checked against the staged outcomes, accepted stories, and 17-task plan in this worktree.
