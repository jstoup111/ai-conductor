**Status:** Accepted

# Stories: Stacked rounds reach whole-feature validation

Source: jstoup111/ai-conductor#3682. Technical track, Medium tier.

## Scope and authority

The operator approved all four intake outcomes, approach A, the diagram, and the lightweight architecture review. Governing design: `.docs/decisions/architecture-review-2026-11-19-stacked-rounds-halt-before-final-gates-on-feature-.md`; existing ADRs `adr-2026-10-07-per-child-build-region` and `adr-2026-10-12-routed-whole-feature-repair`.

“Required validation” means child validation that remains valid under the existing completion, invalidation, and routed-round rules. Unaffected children need not rerun solely because another round occurred. “Settled routing” means the existing routing authorities permit leaf validation: no outstanding host or revalidation work. “Completed BUILD” means authoritative child completion is satisfied, not merely that a task counter is full.

This adds coverage for the absent-root-status transition. Existing #3445 continuation and #3597 outstanding-work stories retain their authority; their routing algorithms and retry limits are not redesigned here.

## Story 1: A settled routed round enters whole-feature validation without a false halt

**Requirement:** TI-1 — #3682 desired outcome 1.

As the operator of a stacked feature, I want completed routed work to proceed directly to whole-feature validation so that I do not manually clear a pending-suite halt after each round.

### Acceptance Criteria

#### Happy Path
- Given a routed round settles on the leaf, all required child validation is satisfied, and feature-level BUILD-region statuses are absent, when the live run continues, then the first pending whole-feature gate starts in that same run without a pending-`test_suite` prerequisite HALT or repeated completed BUILD.
- Given the last routed host is different from the leaf and its exit leaves routing settled with valid leaf validation, when whole-feature validation starts, then it judges the leaf's whole implementation rather than the former host's scope.

#### Negative Paths
- Given the previous host passed but the leaf still requires validation, when that host exits, then no whole-feature gate starts on the strength of the host's pass and the missing leaf validation runs first.
- Given a repair host or revalidation entry remains outstanding, when the run reaches the handoff, then no whole-feature gate starts before that work settles, even if root statuses claim success.

### Done When
- [ ] A bounded live-handoff test starts with absent root region statuses and observes a whole-feature dispatch, zero repeated completed BUILD dispatches, and no false prerequisite HALT.
- [ ] A host-distinct-from-leaf fixture proves the selected scope is the leaf; contrasting incomplete-leaf and outstanding-work cases observe zero whole-feature dispatches before their prerequisites settle.

## Story 2: Restart preserves completed child work

**Requirement:** TI-2 — #3682 desired outcome 3 and the restart form of outcome 1.

As the operator, I want restart after routed leaf return to select the same necessary work as the live run so that a restart does not send completed BUILD work into a zero-progress loop.

### Acceptance Criteria

#### Happy Path
- Given routing is settled, required leaf validation is satisfied, root region statuses are absent, and whole-feature validation remains pending, when the process restarts, then its first dispatched work is the pending whole-feature validation with no completed BUILD dispatch and no false pending-suite HALT.
- Given a process stops after durable leaf return but before whole-feature validation begins, when preflight completes recovery, then the resumed run reaches the same next validation as an uninterrupted run from the equivalent state without operator edits to engine state.

#### Negative Paths
- Given an earlier round has a recorded leaf return but a newer round still has unfinished work, when the feature resumes, then the newer work retains precedence and the older return does not admit whole-feature validation.
- Given the child identity or required child state cannot be resolved or read, when restart evaluates entry, then no whole-feature validator starts and the run reports the unresolved child/state problem rather than treating missing root fields as runnable BUILD work.

### Done When
- [ ] Paired live/restart fixtures produce the same first intended validator dispatch with root region fields absent and no BUILD dispatch for already-completed work.
- [ ] Recovery after durable return needs no manual state changes; historical-return and unreadable-state fixtures cannot start whole-feature validation.

## Story 3: Genuinely missing validation runs before final gates

**Requirement:** TI-3 — #3682 desired outcomes 2 and 4.

As the operator, I want unfinished validation to run at its existing owner so that eliminating a false halt does not bypass a real prerequisite.

### Acceptance Criteria

#### Happy Path
- Given routing is settled, leaf BUILD is complete, and the leaf suite still needs to run, when the live or resumed run selects its next work, then it runs the leaf suite before whole-feature validation without first rerunning completed BUILD or halting solely to redispatch that runnable suite.
- Given the leaf suite is valid and build review is the remaining unmet region gate, when selection runs, then build review runs before whole-feature validation; the valid suite and completed BUILD are not repeated solely because root region fields are absent.

#### Negative Paths
- Given root state or an old verdict claims success but authoritative child validation is stale or has a negative verdict, when entry is evaluated, then the old success does not admit whole-feature validation and the existing invalidation/recovery rules apply.
- Given required validation is dispatched and fails, when that failure is processed, then whole-feature validation remains blocked and the existing failure path handles it; the transition correction does not mark the failed gate complete.

### Done When
- [ ] Parameterized live/resume tests distinguish suite-needed and review-needed cases by their first dispatched gate and prove zero premature whole-feature dispatches.
- [ ] Stale/negative-evidence and failed-validation cases cannot reach whole-feature validation using old root success; failure handling retains its existing gate owner.

## Story 4: The correction preserves state ownership and flat execution

**Requirement:** TI-4 — integrity boundary for TI-1 through TI-3, required by the approved architecture.

As the operator, I want the handoff correction to preserve existing feature and child records so that successful validation remains recoverable and other workflows keep their behavior.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature enters whole-feature validation using valid child completion, when the whole-feature result and resume position are recorded, then they remain feature-owned while the child validation records retain their ownership; root region fields are not populated with synthetic child completion.
- Given a flat feature with no durable children, when ordinary gate checks and restart selection run, then they keep their existing dispatch and persistence behavior without requiring stacked evidence.

#### Negative Paths
- Given the previous host has a different resume position from the leaf and feature, when the leaf transition records the next whole-feature step, then it neither overwrites the former host's region cursor nor reports a false concurrent-state conflict solely because the cursor owner changed.
- Given child completion is missing while root region fields contain old success, when stacked entry evaluates completion, then it does not substitute root success or manufacture a passing child verdict.

### Done When
- [ ] A handoff persistence assertion confirms whole-feature status/verdict ownership, unchanged former-host region evidence, and absence of synthetic root region completion after dispatch.
- [ ] Existing flat-flow behavior remains proven by scoped regression coverage, and an old-root-success fixture cannot satisfy missing child validation.

## Coverage disposition

All new criteria are assigned to bounded engine integration coverage because the defect spans state adoption, selection, and dispatch. The live and resumed paths are distinct flows; their failure permutations belong in those lower-level integration fixtures rather than duplicated system specs. Reuse the existing routed-leaf-return fixture after removing its synthetic root-suite prerequisite, plus affected selector/resume/state-store coverage where sufficient. BUILD must identify exact cases for each positional criterion and establish RED for new behavior. No whole-suite run is required during this specification pass.

## Negative-category evaluation

Malformed/missing evidence and unresolved identity are covered by Stories 2–4. Partial completion, interruption, stale data, and alternate live/resume branches are covered by Stories 1–3. Cursor ownership and existing compare-and-swap semantics are covered by Story 4; this feature adds no concurrent writer or lock protocol. Filesystem/Git read refusal is an evidence-unavailability case, not successful completion. New authentication, network, resource-allocation, deletion, immutability, exception-hierarchy, and deduplication mechanisms are not introduced, so separate criteria for them are not applicable.

## Verify-Claims Ledger

Verified source and architecture basis is recorded in the approved architecture review. These stories translate the approved scope and design into observable dispatch, refusal, and persistence outcomes. They add no migration, new validation policy, broad recovery audit, or new product decision. Verify-claims verdict: CLEAR. The operator approved these stories in this composer session.
