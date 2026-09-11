# ADR: The judging engine is part of the build_review cache identity

**Date:** 2026-08-21
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop for #1759

<!-- Filename convention: adr-{{DATE}}-<kebab-slug>.md (no sequential numbers).
     The ADR's identifier is its filename stem — cite that when superseding or referencing. -->

Amends §7 of [adr-2026-08-13-engine-managed-build-review-rubric-branches](adr-2026-08-13-engine-managed-build-review-rubric-branches.md). Nothing is superseded.

## Context

The build_review semantic cache (`src/conductor/src/engine/build-review-cache.ts`) reuses a rubric's
judged result when rubric id, contract version, projection version, `projectionDigest`, and
`policyFingerprint` all match. Neither component identifies the engine that produced the verdict:
`policyFingerprint` hashes only provider/model/effort/ladder/retries/escalate
(`build-review-registry.ts`), and the projection digests graded content only — by design
(operator ruling 2026-08-15: "cache identity digests semantic content only; commit-addressed and
execution provenance is excluded").

Consequence (#1759, verified 2026-08-20): three build_review fixes merged, the daemon restarted on
the new dist, and the next dispatch replayed a `scope` FAIL the new engine is written not to
produce, because the graded diff had not changed. The symmetric failure also exists: a stricter
rubric never reaches a cached PASS. Recovery was hand-deleting cache files.

Two judging inputs live outside the projection:

1. **Engine code** — identified by the published dist id `<YYYYMMDDTHHMMSSZ>-<12hex>`
   (`engine-version-id.ts`), where the 12-hex suffix is a sha256 content stamp over the dist source
   (`engine-store.ts` `computeContentStamp`, verified) and the prefix is the publish time.
2. **Rubric skill text** — `skills/build-review-<rubric>/SKILL.md` is the live contract surface
   ([adr-2026-08-16-preservation-anchored-completeness-exemption]). Installed skills symlink to the
   live checkout, so skill text changes without a dist publish.

Constraints from APPROVED decisions (full `.docs/decisions/` sweep performed):

- adr-2026-08-13 §7: "changing any field visible to a rubric, its contract, or its resolved
  execution policy invalidates that rubric deterministically" — the property this ADR extends.
- adr-2026-08-19 (engine-stamped envelope) D3 asserted envelope-writer changes leave cache identity
  unaffected; this ADR knowingly spends one cold lap per feature per engine content change.
- adr-2026-08-16 D4: `contractVersion` changes only when identity semantics change; dispositions
  bind by contract version. The skill digest is a **cache** lever only and never touches
  disposition binding.
- adr-2026-08-18 D2/D7: miss reasons are total and closed at the type level; distinct classes must
  not collapse; reduced-coverage decisions keyed on `{rubric, reason}` must not acquire an engine
  dependency.
- adr-2026-07-26: every new `ConductorEvent` type declares `render/persist/audit` in `EVENT_SINKS`.
- adr-2026-07-03 (stale-engine restart): "an input-identical rebuild yields the same identity and is
  correctly NOT stale."
- Operator ruling 2026-08-15: execution timing is provenance and stays out of digested identity.

## Options Considered

### Option A: Fold the engine version id into `policyFingerprint`
- **Pros:** ~10 lines; no schema change.
- **Cons:** Collapses an engine-change miss into `policy-fingerprint-mismatch` (violates
  adr-2026-08-18 D2's distinct-classes rule and the observability outcome); misses skill-only edits.

### Option B: Digest only the rubric's decision surface (SKILL.md + prompt template + contract version)
- **Pros:** Precise — only rubrics whose judging inputs moved lose entries.
- **Cons:** Engine post-processing changes that alter verdicts without touching prompt or projection
  still replay — the #1759 failure class is engine code.

### Option C: A sibling `engineIdentity` component carrying both, with distinct miss reasons (chosen)
- **Pros:** Closes both gaps; each miss names its cause; `policyFingerprint` untouched.
- **Cons:** One cold 4-rubric lap (~$2) per warm feature per engine content change.

## Decision

**D1. `engineIdentity` is a sixth, sibling component of the cache identity**, alongside (not
inside) `policyFingerprint`:
`{ engineStamp: string; skillDigest: string }`. A mismatch on `engineStamp` misses with reason
`engine-version-mismatch`; a mismatch on `skillDigest` misses with reason `skill-digest-mismatch`.
Both are added to the closed `BuildReviewCacheMissReason` union and checked after
`policy-fingerprint-mismatch`.

**D2. `engineStamp` is the 12-hex content stamp only**, never the timestamp half. Byte-identical
republishes keep warm caches (adr-2026-07-03 precedent); publish time is execution provenance
(2026-08-15 ruling). When the running engine has no `dist-versions` id (plain `src/conductor/dist`),
the stamp is the constant sentinel `dev` — the same disposition `resolveEngineVersion()` in
`shipped-record.ts` already takes. Dev-to-dev hits; dev and published never match. This is accepted
because dev runs are not daemon-served and the alternative (never cache in dev) taxes every dev lap.

**D3. `skillDigest` is `sha256:` over the raw bytes of the rubric's installed
`skills/build-review-<rubric>/SKILL.md`**, resolved through the existing skill-resolution seam
(`skill-resolver.ts` / harness root) — no normalizer. Any edit re-judges. If the file cannot be
read, the rubric is an infrastructure failure (`skill-digest-unavailable`), never a hit and never a
write, per the fail-closed rule of adr-2026-08-13 §7.

> **Amended 2026-08-21 by #1759 (conflict-check):** the failure reuses the existing closed reason `cache-read-failed` with a detail naming the SKILL.md path instead of adding `skill-digest-unavailable`; PR #1734 (adr-2026-08-18) makes the infrastructure-reason→fault-class mapping a total record, and the clean-rubric spec's shipped rule keeps that vocabulary closed. Behavior (no hit, no write) is unchanged.

> **Amended 2026-09-10 by #1986:** D3's harness-root single-file approximation is replaced by the complete effective policy bundle resolved inside the actual prepared provider candidate, for built-in and custom rubrics. The captured bytes are also delivered to that candidate. Missing or incomplete policy still permits neither lookup nor write (adr-2026-09-10-portable-build-review-policy D2/D3/D6).

**D4. Legacy entries are parsed in a staged form.** `parseBuildReviewCacheEntryCandidate` accepts
`engineIdentity` as optional; an absent field classifies as `engine-version-mismatch` so the first
post-ship lap is observable per rubric rather than disappearing into `invalid-entry`. Newly written
entries always carry the field; an entry with the field in a malformed shape is `invalid-entry`.

**D5. A discard is an event on the spine, never a log line.** New `ConductorEvent` variant
`build_review_cache_discarded { rubric, lapId, reason: 'engine-version-mismatch' |
'skill-digest-mismatch', cachedEngineStamp?, currentEngineStamp }`, declared in `EVENT_SINKS`
with `render: true, persist: true, audit: true` so the daemon log names the rubric and the cause. The
existing `build_review_cache_hit` is unchanged. Only these two engine-identity reasons emit the
event; ordinary projection/policy misses stay silent as today.

**D6. The engine identity is resolved once per build_review dispatch and injected into the
coordinator** (`coordinateBuildReviewRubrics` input), not read from `process.env` or `import.meta`
inside the cache module, keeping `build-review-cache.ts` pure and unit-testable with fakes.

> **Amended 2026-09-10 by #1986:** only the engine content stamp remains once-per-run. Effective policy identity, cache lookup, and eligible write belong inside the actual candidate's preparation lifecycle, including fallback, with typed inputs keeping the cache pure (adr-2026-09-10-portable-build-review-policy D6).

**D7. Out of scope (operator-confirmed boundary):** an operator cache-clear command, bulk clearing on
daemon engine rollover, KPI/dashboard surfacing. `engineIdentity` never enters the disposition
store or reduced-coverage keys (adr-2026-08-18 D7).

> **Amended 2026-09-10 by #1986:** existing built-in operator-disposition bindings remain unchanged. New custom evidence and dispositions bind to their own versioned declaration and effective-policy identity so changed same-named policy cannot borrow prior authorization; engine timing or publication identity does not grant or erase operator authority (adr-2026-09-10-portable-build-review-policy D6/D7).

> **Amended 2026-09-10 by #1986:** the preceding amendment's common custom-disposition binding is narrowed by approved adr-2026-09-10-separate-custom-review-coverage-identity. Custom finding acceptance remains content-bound; custom reduced coverage instead binds to the feature, validated declaration, and closed failure reason, because a loading failure may have no effective content identity. The latter accepts missing coverage only, survives package changes with the same declaration/reason, and cannot suppress a finding or make an unjudged lap pass. Built-in binding and judged-result cache identity are unchanged.

## Consequences

### Positive
- A build_review fix reaches every warm feature on its next dispatch with no operator action.
- A stricter rubric cannot be bypassed by a stale PASS.
- Skill-text edits — which ship without a dist publish — invalidate exactly the rubric they touch.
- Discards are attributable in `events.jsonl` and the daemon log by rubric and cause.

### Negative
- One cold lap per warm feature per engine content change (~$2 of opus grading each). Accepted over
  silently replaying a wrong verdict in either direction.
- Typo-only SKILL.md edits re-judge that rubric everywhere.
- adr-2026-08-19 D3's "no re-judge lap is spent" benefit no longer holds across engine publishes.

### Follow-up Actions
- [ ] Stories and plan for #1759 implement D1–D6 (engineer loop).
- [ ] Amendment note recorded beside adr-2026-08-13 §7 (done in this spec).

> **Amended 2026-08-22 by #1805:** rubric membership is now the registry with test-quality as the only member (default off), an empty enabled set is a valid no-dispatch PASS, and retired rubric keys are accepted as no-ops; four-rubric enumerations here narrow to the registry (adr-2026-08-22-build-review-opt-in-rubric-container).
