**Status:** Accepted

# Stories: Generalize source-ref parsing/formatting (GitHub + Jira)

Technical track — derived from adr-2026-07-22-canonical-tagged-source-ref (APPROVED)
and architecture-review-2026-07-22-generalize-source-ref-parsing.
Feature slug: generalize-source-ref-parsing-formatting-to-suppor
Source: intake jstoup111/ai-conductor#847 (refs #774). Tier: M.

---

## Story: Canonical tagged parse for GitHub refs and Jira keys

**Requirement:** ADR §Decision — `parseWorkRef` / `WorkRef` union

As a harness engine developer, I want one canonical `parseWorkRef` that tags
refs by backend so that every ref-consuming site shares a single grammar owner.

### Acceptance Criteria

#### Happy Path
- Given the ref `acme/app#49`, when `parseWorkRef` is called, then it returns `{ kind: 'github', repo: 'acme/app', number: '49' }`
- Given the ref `PROJ-123`, when `parseWorkRef` is called, then it returns `{ kind: 'jira', key: 'PROJ-123' }`
- Given the ref `AB2C-7`, when `parseWorkRef` is called, then it returns `{ kind: 'jira', key: 'AB2C-7' }` (digits allowed after first letter)

#### Negative Paths
- Given the ref `proj-123` (lowercase key), when `parseWorkRef` is called, then it returns `null` (grammar is uppercase-only per ADR)
- Given the ref `P-1` (single-char key), when `parseWorkRef` is called, then it returns `null` (key requires ≥2 chars)
- Given the ref `PROJ-` or `PROJ-12a`, when `parseWorkRef` is called, then it returns `null` (strict digits after the hyphen)
- Given the ref `acme/app#` or `#49` or `acme/app#4x`, when `parseWorkRef` is called, then it returns `null` (existing GitHub malformed-ref contract preserved)
- Given `undefined`, `null`, or `""`, when `parseWorkRef` is called, then it returns `null` without throwing
- Given the ambiguous-looking ref `A/B#1-2`, when `parseWorkRef` is called, then it is parsed by the GitHub grammar or rejected — never as Jira (any ref containing `#` or `/` can never produce `kind: 'jira'`)

### Done When
- [ ] `src/conductor/src/engine/engineer/source-ref.ts` exports `WorkRef`, `parseWorkRef`, and the Jira grammar constant `^[A-Z][A-Z0-9]+-\d+$`
- [ ] Unit tests cover every scenario above and pass
- [ ] No other module defines a competing ref grammar (repo grep for `lastIndexOf('#')`-style ref parsing outside the module and its shim finds only the pr-labels URL parser)

---

## Story: Lossless round-trip formatting

**Requirement:** ADR §Decision — `formatWorkRef`

As a harness engine developer, I want `formatWorkRef(parseWorkRef(s)) === s`
for every valid ref so that ledger keys and markers never mutate a ref in flight.

### Acceptance Criteria

#### Happy Path
- Given any valid GitHub ref (e.g. `acme/app#49`), when parsed then formatted, then the output equals the input byte-for-byte
- Given any valid Jira key (e.g. `PROJ-123`), when parsed then formatted, then the output equals the input byte-for-byte

#### Negative Paths
- Given a hand-built `WorkRef` with empty fields (e.g. `{ kind: 'github', repo: '', number: '' }`), when `formatWorkRef` is called, then it throws or is unrepresentable at the type level — it never emits a malformed ref string
- Given a valid ref with surrounding whitespace (`" PROJ-123 "`), when parsed, then `parseWorkRef` returns `null` (no silent trimming — the round-trip property stays exact; callers own normalization)

### Done When
- [ ] Property-style test: parse→format identity over a corpus of valid GitHub refs and Jira keys
- [ ] `formatWorkRef` has no code path that emits a string `parseWorkRef` would reject

---

## Story: `parseSourceRef` compat shim — zero GitHub regressions

**Requirement:** ADR §Migration strategy (compat shim)

As a maintainer of the 7 existing `parseSourceRef` consumers, I want the shim to
behave byte-identically to today's parser so that no GitHub flow changes at all.

### Acceptance Criteria

#### Happy Path
- Given any ref, when `parseSourceRef` (reimplemented over `parseWorkRef`) is called, then its result equals the pre-change implementation's result — verified by a golden test running both implementations over an edge-case corpus (multiple `#` (`a#b#4`), leading-zero numbers (`a/b#01`), empty repo (`#5`), trailing `#` (`a/b#`), non-digit numbers (`a/b#4x`), unicode repo segments, `undefined`/`null`/`""`)
- Given a Jira key `PROJ-123`, when `parseSourceRef` is called, then it returns `null` (GitHub-only consumers take their existing non-fatal no-op path)

#### Negative Paths
- Given the intake ledger with an existing entry keyed by a GitHub ref, when the same `(source, sourceRef)` is recorded again after the change, then it dedups exactly as before (no false negatives from any canonicalization — the ledger key remains the raw opaque string, `ledger.ts:80` untouched by the diff)
- Given two distinct refs that must not collide (`acme/app#49` vs `PROJ-49`), when each is used as a ledger key with the same source, then they produce distinct entries (no false-positive dedup)
- Given a Jira ref reaching `gate-writeback.ts`'s comment path, when the writeback runs, then it skips non-fatally (same code path as today's malformed-ref skip) and the surrounding gate flow completes without error

### Done When
- [ ] Golden equivalence test exists and passes (old behavior captured as fixture expectations, not by keeping the old code)
- [ ] `parseSourceRef` in `issue-ref.ts` is a narrowing wrapper over `parseWorkRef` with its exact current signature
- [ ] Full existing test suite passes with zero modifications to any `parseSourceRef` consumer's tests

---

## Story: Jira-aware intake markers — lossless write and read-back

**Requirement:** ADR §Per-consumer disposition (intake-marker.ts, artifacts.ts)

As an operator routing Jira-originated ideas, I want the `.docs/intake/<slug>.md`
marker to carry `Source-Ref: PROJ-123` losslessly so that issue origin travels
with the spec and survives read-back.

### Acceptance Criteria

#### Happy Path
- Given a claim with `sourceRef: 'PROJ-123'`, when the intake marker is written, then the marker contains `Source-Ref: PROJ-123` verbatim
- Given a committed marker carrying `Source-Ref: PROJ-123`, when `artifacts.ts` reads the spec's source ref back, then it returns `PROJ-123` (today it returns `undefined` because `parseSourceRef` rejects it)
- Given a GitHub marker (`Source-Ref: acme/app#49`), when written and read back, then behavior is unchanged from today

#### Negative Paths
- Given a marker with a malformed ref (`Source-Ref: proj_123!`), when read back, then the reader returns `undefined` exactly as today (parseWorkRef null → dropped, no crash)
- Given a claim whose `sourceRef` is empty/whitespace, when the marker write validity check runs (`intake-marker.ts:51`), then no `Source-Ref:` line is emitted (existing contract preserved)
- Given a Jira-ref spec landing via `engineer land --source-ref PROJ-123`, when the GitHub issue-comment writeback cannot apply (`kind !== 'github'`), then the land still succeeds and the marker still commits (write-back is advisory; the invariant side effect — marker + ledger advance — occurs on the skip branch too)

### Done When
- [ ] Round-trip test: claim(sourceRef=Jira) → marker write → artifacts read-back yields the identical string
- [ ] `intake-marker.ts` and `artifacts.ts` marker read-back call `parseWorkRef` (not the GitHub-only shim)
- [ ] Land-with-Jira-ref integration test shows marker committed + ledger advanced while GitHub writeback skipped non-fatally
- [ ] Owner-stamp compatibility (conflict resolution vs `owner-stamped-at-authoring.md`): the existing `intake-marker.test.ts` stamp-when-owned / omit-when-blank / no-op assertions still pass — a Jira ref reclassifies from invalid→valid at `intake-marker.ts:51` without changing any owner-stamp semantics

---

## Story: Duplicate parsers retired — all sites delegate to the canonical module

**Requirement:** ADR §Per-consumer disposition (label-sync, issue-dep-migration, backlog-priority, pr-labels)

As a harness engine developer, I want the four duplicate ref parsers deleted and
delegating to the canonical module so that a grammar change lands in exactly one place.

### Acceptance Criteria

#### Happy Path
- Given `label-sync.ts`, when it validates a `Depends-on` ref, then it delegates to the canonical module (local `SLUG_REF_RE` deleted) and GitHub refs behave as today
- Given `issue-dep-migration.ts` and `backlog-priority.ts`, when they parse refs for gh API calls, then they delegate (local `parseRef` / `parseIssueRef` deleted); `backlog-priority`'s owner/repo split comes from a helper on the canonical module
- Given `intake/backfill.ts` (6th parser found by conflict-check sweep, `parseRef` at line 111), when the backfill sweep parses refs, then it delegates too (local regex deleted); a Jira ref remains a per-issue failure, never a HALT (existing contract)
- Given `pr-labels.ts`, when it parses a github.com PR/issue URL, then it keeps its own URL regex but returns the shared `{repo, number}` shape

#### Negative Paths
- Given a Jira ref in a `Depends-on` list, when `label-sync` / `issue-dep-migration` / `backlog-priority` process it, then each skips it non-fatally (no gh API call attempted with a Jira key, no thrown error, a debug-level skip is acceptable)
- Given a github.com URL with a Jira-looking path (`github.com/PROJ-123/x/pull/9`), when `pr-labels.parseIssueRef` runs, then it parses by its URL grammar only — the canonical ref grammar is never consulted for URLs
- Given the strict repo grammar `SLUG_REF_RE` enforced today in label-sync (`[\w.-]+/[\w.-]+#\d+`), when delegation replaces it, then refs that the lenient canonical GitHub grammar accepts but the strict regex rejected (e.g. repo segment with spaces) do NOT silently start flowing to the gh API — the delegating call site applies the module's strict-slug helper (or equivalent) so its accepted set is unchanged

#### Dedup/idempotency key analysis
- Given the same Jira ref claimed twice from intake, when the ledger dedup check runs, then the second claim is recognized as a duplicate (key = `source\0PROJ-123` both times)
- Given the same ticket referenced as `PROJ-123` from source A and `PROJ-123` from source B, when both are recorded, then they remain distinct ledger entries (source is part of the key — no cross-source false dedup)

### Done When
- [ ] Repo grep confirms `SLUG_REF_RE`, `issue-dep-migration.ts`'s `parseRef`, `backlog-priority.ts`'s `parseIssueRef`, and `intake/backfill.ts`'s `parseRef` no longer exist as local grammar definitions
- [ ] Sequencing note honored: if the pending closed-issue-guard spec (`intake-claim-closed-issue-guard-and-brain-sweep.md`, landed but unbuilt) builds a ref parse before or after this feature, it delegates to the canonical module — its TR-5 "shared/consistent parse" is satisfied by delegation, never by a new local grammar
- [ ] `pr-labels.ts` imports the shared return type; its URL regex is untouched
- [ ] All existing tests for the four sites pass unchanged; new tests cover the Jira skip path at each site
