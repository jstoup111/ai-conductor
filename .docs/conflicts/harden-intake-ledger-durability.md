# Conflict Check: Harden intake ledger durability (#1476)

**Date:** 2026-08-12
**ADR corpus:** `change_set` (the `conflict_check.adr_corpus` default per
`src/conductor/src/engine/config.ts:943`; the key is not set for this project). The change set's
approved ADR is `adr-2026-08-12-fail-closed-intake-ledger-durability`. Because that ADR carries
`Amends: adr-012-durable-intake-ledger-sole-dedup-authority`, ADR-012 was compared as well. No
corpus narrowing or supersession parsing was applied — those belong to `repo_wide` scope only.
**Inventory:** all 9 stories in `.docs/stories/harden-intake-ledger-durability.md`; the two
approved ADRs above; every `.docs/plans/` entry matching the ledger/lease surface and its
`.docs/shipped/` status; all 10 open pull requests.
**Result:** **PASS — zero blocking conflicts.** Two degrading underspecifications were found and
**resolved** by operator decision; both stories were amended. No degrading conflict remains
accepted-but-unresolved.

## Scan method

The feature's production surface is small and enumerable, so the external scan was exhaustive
rather than sampled.

| File this change touches | Open PR touching it | Unshipped plan touching it |
|---|---|---|
| `src/conductor/src/engine/engineer/intake/ledger.ts` | none | none |
| `src/conductor/src/engine/conduct-state-lease.ts` | none | none |
| `src/conductor/src/engine/engineer-cli.ts` | none | none |
| `src/conductor/src/engine/engineer/loop.ts` | none | none |
| `src/conductor/src/engine/engineer-store.ts` | none | none |

Open PRs #1526, #1522, #1519, #1518, #1514, #1495, #1433, #1168, and #890 were each checked with
`gh pr diff --name-only` against that file list; none touches any of them. #1467 is the bot-owned
release PR and is excluded by construction — this branch writes neither `VERSION` nor
`CHANGELOG.md`.

Two plans referencing this surface were checked for unshipped status and both are already shipped:
`intake-claim-closed-issue-guard-and-brain-sweep` and
`conduct-state-json-lost-update-conductor-s-whole-o` (the latter is the plan that produced
`conduct-state-lease.ts`, the primitive this feature reuses — relevant as precedent, not as
contention).

All 36 story pairs were tested in **both** directions against the oscillation heuristic ("if A is
fully satisfied, does B still hold?"). The pairs sharing a behavior, artifact, or gate — and thus
genuinely at risk — were S1↔S2, S1↔S3, S2↔S3, S3↔S5, S3↔S7, S4↔S1, S4↔S5, S5↔S7, S6↔S7, S6↔S9,
S8↔S6, and S8↔S7. The remainder share no surface.

## Near-miss recorded (no action needed)

**Stories 2 and 3 are compatible only because of a specific design choice.** Story 2 asserts
`ledger.json` is byte-identical after a refused mutation; Story 3 asserts the original bytes are
preserved in a quarantine artifact. These hold together **only** because
`adr-2026-08-12-fail-closed-intake-ledger-durability` decision 3 quarantines by **copy**. Had the
design followed `halt-issues/ledger.ts`'s rename, Story 3 would have moved `ledger.json` away and
directly contradicted Story 2's byte-identical assertion — a blocking contradiction. Recorded so a
future change to that clause is understood to break a story pair, not just an implementation
detail.

---

## Conflict A: Quarantine and warning frequency is unbounded under a long-running loop

**Stories involved:** Story 3 (The original bytes survive as a quarantine copy) vs Story 5 (A
corrupt ledger escapes the intake loop's per-envelope error isolation)
**Files:** both in `.docs/stories/harden-intake-ledger-durability.md`
**Type:** state-conflict
**Severity:** degrading
**Story IDs:** Story 3, Story 5
**Story 3 opposing sentence (verbatim):** "Given a corrupt ledger is encountered twice at
distinguishable times, when both encounters complete, then two distinctly-named quarantine files
exist and neither has overwritten the other."
**Story 5 opposing sentence (verbatim):** "Given a corrupt ledger, when the loop reports it, then
the loop does not enter a tight retry spin re-encountering and re-quarantining the same corrupt
file on every poll interval."

**Description:** The intake loop polls on an interval and will encounter the same corrupt ledger on
every cycle. Story 3 read literally requires a distinct quarantine file per encounter; Story 5
requires that repeated encounters not accumulate. Fully satisfying Story 3 breaks Story 5. Tested
in the other direction: suppressing repeats still satisfies Story 3's real intent — that the
original bytes are recoverable — so this is a one-directional degradation, not an oscillation. The
root is an underspecification in story text (neither story says whether "encounter" means per
operation or per corruption episode), so it resolves in `stories`, not upstream.

**Resolution Options:**
1. Key the quarantine and the warning to the **corruption episode** (the corrupt byte-state): the
   first encounter quarantines and warns; identical subsequent encounters still refuse but reuse
   the copy and stay quiet; a *different* corruption is a new episode with its own file.
2. Quarantine and warn on every refusing operation, and accept unbounded files plus repeated
   stderr under a live loop.
3. Have the loop halt intake entirely on first corruption so no second encounter occurs.

**Recommendation:** Option 1 — it bounds both artifacts and noise without weakening any refusal,
and every operation still fails loudly via its exit code.

**Operator decision: Option 1.** Applied — Story 3's happy-path criterion was amended (original
preserved in an additive note) and Story 5 gained an explicit once-per-episode criterion plus a
resume-after-repair criterion.

---

## Conflict B: Lock-acquiring reads serialize the intake poll path machine-wide

**Stories involved:** Story 6 (Concurrent mutations from separate processes are additive) vs
Story 7 (Read-only ledger methods never observe a torn state)
**Files:** both in `.docs/stories/harden-intake-ledger-durability.md`
**Type:** resource-contention
**Severity:** degrading
**Story IDs:** Story 6, Story 7
**Story 6 opposing sentence (verbatim):** "Given N separate processes each calling `record()` for a
distinct `(source, sourceRef)` against the same ledger path concurrently, when all N have
completed, then all N entries are present in `ledger.json`."
**Story 7 opposing sentence (verbatim):** "Given a write is in progress under the lease, when
`list()` is called from another process, then it returns either the complete pre-write state or the
complete post-write state, never a mixture."

**Description:** Story 7 puts reads under the same lease as writes. `known()` is called for every
polled envelope on the intake hot path, and the ledger resolves to a single machine-wide file
(`~/.ai-conductor/engineer/ledger.json` — see Story 6's scope note), so every poll now contends
with every engineer CLI verb across every project on the host. Neither story is violated; the cost
is throughput and the risk is that a slow or stuck holder blocks inspection verbs too. Both
directions were tested: satisfying Story 7 leaves Story 6 fully true, and vice versa — so this is
contention to be accepted or designed around, not a contradiction.

Note that the two stories' timeout criteria are **not** in conflict: Story 7's "a concurrent
mutation waits rather than failing immediately" and Story 6's "a live owner past the acquire
timeout yields a lease-timeout failure" compose correctly as wait-then-timeout.

**Resolution Options:**
1. Acquire the lease on reads as `adr-2026-08-12-fail-closed-intake-ledger-durability` decision 5
   specifies; accept bounded contention.
2. Leave reads lock-free, relying on `saveStore`'s atomic tmp+rename so a reader sees either the
   whole old file or the whole new one; requires amending ADR decision 5.
3. Acquire on `list`/`get` (operator inspection) but not on `known` (hot path), accepting a
   narrow torn-read window exactly where dedup decisions are made.

**Recommendation:** Option 1 — ledger operations are per-idea rather than per-request, so the
contention is bounded, and a torn read of the dedup authority is the worse failure. Option 3 is
the wrong trade: it removes the guarantee precisely where it matters most.

**Operator decision: Option 1.** Applied — a contention note was added to Story 7 recording the
accepted cost and the rejected alternative. No ADR change was required.

---

## ADR-versus-story comparison

Every story was compared against both approved ADRs in scope. No conflict was found; the grounding
below records the checks that could plausibly have failed.

| ADR clause | Stories touching it | Verdict |
|---|---|---|
| `adr-2026-08-12` D1 (absent vs unparseable are distinct) | Story 1, Story 2 | Consistent — Story 1 pins the absent branch, Story 2 the unparseable branch. |
| `adr-2026-08-12` D2 (refuse, do not continue empty) | Story 2, Story 7 | Consistent — Story 7 extends refusal to reads, which the ADR's decision 5 anticipates. |
| `adr-2026-08-12` D3 (quarantine by copy) | Story 2, Story 3 | Consistent, and load-bearing — see the near-miss above. |
| `adr-2026-08-12` D4 (operator told at the time) | Story 4, Story 5 | Consistent after resolution A bounded the frequency. |
| `adr-2026-08-12` D5 (lease-serialized RMW, reads included) | Story 6, Story 7, Story 8 | Consistent — resolution B affirmed the clause rather than amending it. |
| `adr-2026-08-12` D6 (artifacts in the resolved engineer dir) | Story 9 | Consistent — Story 9 was rewritten during the stories pass to match the amended clause. |
| `adr-012` clause 3 (poll skips candidates already in the ledger in a non-resettable state) | Story 5 | Consistent — Story 5's "no idea dispatched while the ledger is corrupt" is strictly stricter than the ADR's skip rule and does not contradict it. |
| `adr-012` clause 5 (the `engineer:handled` label is a second globally-visible skip signal) | Story 4, Story 5 | Consistent — the amending ADR retains the label as a skip signal and only withdraws its use as the *answer* to a corrupt ledger. |

## Re-check

Re-ran the full pairwise scan after both amendments. Story 3 and Story 5 now agree on
once-per-episode semantics; Story 7 carries an explicit accepted-cost note referencing Story 6.
**Zero blocking conflicts, zero unresolved degrading conflicts.** Proceed to `/plan`.
