# ADR: Fail closed on an unparseable intake ledger, and serialize its writers with a lease

**Date:** 2026-08-12
**Status:** APPROVED
**Approved:** 2026-08-12
**Deciders:** James Stoup, architecture review
**Amends:** adr-012-durable-intake-ledger-sole-dedup-authority
**Source:** intake jstoup111/ai-conductor#1476

## Context

`src/conductor/src/engine/engineer/intake/ledger.ts` is the store ADR-012 designates as the
**sole dedup authority** for intake. Two properties of that file were confirmed by source read
(both 100% confidence, `verified`):

1. `loadStore` (lines 94-102) catches every error identically — `ENOENT` from a first run and a
   `JSON.parse` failure from a truncated or malformed file both return `{}`. Every mutator is
   `load → mutate → saveStore`, and `saveStore` is correctly atomic (tmp write + `rename`).
   The consequence is that a corrupt ledger is not merely misread — it is **durably replaced
   with an empty one** by the next mutation.
2. There is no lease, lock, or compare-and-swap anywhere in the file. The mutating population is
   7 `createLedger` sites in `engineer-cli.ts` (lines 686, 1035, 1087, 1252, 1286, 1330, 1431) —
   one-shot CLI verbs — plus the long-running `engineer/loop.ts`. These are separate OS
   processes, so their read-modify-write cycles interleave and lose each other's writes.

ADR-012's Consequences section records the mitigation for case 1 as: *"A lost/corrupt
`ledger.json` falls back to the GitHub label to avoid reprocessing already-handled issues."*
That mitigation is real but strictly partial, and treating it as sufficient is what left the
wipe unguarded:

- The `engineer:handled` label only exists for entries that reached `done`. Entries in
  `pending`, `claimed`, `routed`, or `deciding` have no label and are unrecoverable.
- The label carries no lifecycle metadata — `attempts`, `branch`, `prUrl`, `capturedAt` are lost
  even where the label does prevent reprocessing.
- The label is a GitHub artifact, so it does not cover the `claude-session` source at all.

The failure is silent at the moment it occurs. Its observable consequence — duplicate claims and
duplicate spec PRs — appears later and reads as a dispatch bug rather than as data loss.

An APPROVED precedent for the corrective shape already exists in this repository.
`adr-2026-08-01-conduct-state-mutation-port` specifies that the filesystem state adapter
"serializes all writers with a bounded cross-process lease, reads the latest snapshot while
holding that lease, evaluates the mutation against current state, and persists with an atomic
temporary-file replacement," and that "an unacquired or unrecoverable lease **fails closed**
rather than writing concurrently." `filesystem-conduct-state-store.ts` implements it, and its
`replace()` path explicitly proves the document readable before a destructive write "so corrupt
or empty input is not silently overwritten". The primitive behind it,
`conduct-state-lease.ts`, is generic over any path (`«path».lease`), mkdir-atomic, carries owner
metadata with a liveness probe and stale-owner recovery, and is fully dependency-injected. It is
currently imported by exactly one consumer (verified by grep).

## Decision

1. **Absent and unparseable are distinct outcomes.** A ledger file that does not exist continues
   to yield an empty store, silently — first run is not an error. A ledger file that exists but
   does not parse is never treated as an empty ledger.

2. **An unparseable ledger refuses the mutation.** The operation fails; `saveStore` is not
   reached. This is deliberately stricter than the quarantine-and-rebuild shape in
   `halt-issues/ledger.ts:103-138`, which warns, quarantines, and then returns an empty schema.
   That ending is correct for a rebuildable cache and wrong for a dedup authority: continuing
   empty still produces the duplicate claims and duplicate spec PRs this ADR exists to prevent.

3. **The original bytes are preserved by copy, not by rename.** The quarantine artifact is
   `ledger.json.corrupt-«timestamp»` and `ledger.json` is left in place. A rename would leave the
   canonical path absent, so a concurrent process would take the first-run branch of decision 1
   and start empty — reintroducing the wipe by another route. A copy makes the refusal
   repeatable and idempotent.

4. **The operator is told at the time of the corrupt read**, by a warning naming both the ledger
   path and the quarantine path, and by a non-zero exit from the invoking CLI verb. Where a
   caller currently swallows ledger errors, that swallow is corrected as part of this work.
   **Amended 2026-08-16 (operator ruling, as-built audit):** the live corrupt-ledger stop sites
   are the engineer CLI launch pre-poll and command dispatch (`engineer-cli.ts:812-824,1556`,
   `reportCorruptLedger`) and the background intake loop's episode handling
   (`intake/intake-loop.ts:135-148`). The originally named `engineer/loop.ts:258-267`
   (`runEngineerMode`) has no live production caller (superseded by the agent-hosted engineer
   flow, ADR-008); its edit was reverted rather than retained as dormant code, and the dead
   path's cleanup is tracked as a follow-up intake.

5. **Every read-modify-write is serialized by a lease** obtained from `conduct-state-lease.ts`
   at `«ledger path».lease`, following the `whileHoldingLease(read → mutate → write)` shape of
   `filesystem-conduct-state-store.ts`. Read-only methods (`known`, `get`, `list`) also acquire,
   so no caller observes a torn intermediate state. Consistent with the precedent ADR, a lease
   that cannot be acquired or recovered fails the operation rather than proceeding unguarded.

6. **The lease lives beside the ledger, in the resolved engineer directory.** The daemon's
   `O_EXCL` pidfile in `daemon-lock.ts` is untouched, and no lock state is placed in `.daemon/`.

   > **Amended 2026-08-12 by #1476 (same DECIDE pass):** this clause originally described the
   > engineer directory as a repo-relative `.engineer/`, echoing the notation in ADR-011 and
   > `components-engineer-intake.md`. That is wrong, and the error was caught by reading
   > `resolveEngineerDir` (`src/conductor/src/engine/engineer-store.ts:185-193`) rather than
   > trusting the notation. The directory resolves to **`$AI_CONDUCTOR_ENGINEER_DIR`, or
   > `~/.ai-conductor/engineer/` by default** — a **user-global path outside every repository**.
   > The clause now says "the resolved engineer directory" and the correction propagates as
   > follows:
   >
   > - **The ledger is a cross-repo singleton, not per-project.** Every registered project's CLI
   >   verbs and every engineer loop on this machine mutate the *same* `ledger.json`. This makes
   >   decision 5 (lease-serialized read-modify-write) substantially more load-bearing than the
   >   original framing implied — the concurrent writers are not just several verbs against one
   >   repo's state, they are all activity across all projects.
   > - **The blast radius of the wipe is correspondingly larger.** The live ledger observed at
   >   authoring time held 296 entries across every project this operator has routed. A single
   >   malformed write destroys the dedup authority for all of them at once.
   > - **Git ignore rules are irrelevant.** The ledger and its new artifacts are outside any
   >   working tree, so they can neither be committed nor trip a repository guard. The original
   >   review condition on this point is withdrawn — see the amendment note in
   >   `architecture-review-2026-08-12-harden-intake-ledger-durability.md`.
   > - **The self-host live boundary is unaffected**, for the same reason: it fingerprints the
   >   root checkout, which never contains this path.
   >
   > Two hand-made backups (`ledger.json.bak`, `ledger.json.bak-20260703`) sit beside the live
   > ledger — prior evidence that this file has already been treated as worth protecting by hand.

7. **This ADR amends ADR-012's corrupt-ledger consequence.** The GitHub label remains a useful
   second, globally-visible skip signal exactly as ADR-012 decision clause 5 describes; it is no
   longer relied upon as the answer to a corrupt ledger. ADR-012's decision clauses are otherwise
   unchanged and remain authoritative — this ADR is additive and supersedes nothing.

## Scope boundary — this is not the #243 claim lease

`adr-2026-07-22-heartbeat-lease-deferred` defers a **claim heartbeat/lease**: an ownership
signal a live DECIDE session refreshes so stale-claim recovery can tell an abandoned `claimed`
entry from one being actively worked. That is a session-lifecycle concern and remains deferred.

The lease decided here is a **file-write mutual exclusion** held for the microseconds of one
read-modify-write. It does not register session ownership, is not refreshed, and does not
survive the operation. It therefore does **not** close the bounded duplicate-processing window
that ADR accepted as residual risk, and must not be cited as having done so.

## Alternatives Rejected

- **Quarantine and continue empty** (the `halt-issues/ledger.ts` shape). Preserves the bytes and
  is consistent with sibling code, but leaves dedup lost, so duplicate spec PRs still occur. The
  bytes being recoverable does not help if nothing stops the duplicate work in the meantime.
- **Corrupt-read hardening only, locking deferred to a follow-up.** Smaller and shippable sooner,
  and the corrupt path is the durable loss while write races are in principle recoverable. It
  leaves the stated outcome "N processes each adding a distinct entry leave all N present"
  unmet, and pays the cost of touching all 8 call sites twice. Rejected by operator decision.
- **Restructure `Ledger` to return result objects** (`{kind:'corrupt'|'lease'|'ok'}`) mirroring
  `FilesystemConductStateStore`'s typed returns. Most consistent long-term, but a breaking
  interface change across 8 call sites and 3 test files for what is fundamentally a durability
  fix. The existing throw-based contract propagates correctly once decision 4's swallow is
  corrected. Rejected as disproportionate blast radius; a future unification remains open.
- **A new bespoke lock primitive for the ledger.** Rejected — `conduct-state-lease.ts` already
  provides atomic acquisition, owner liveness, and stale recovery, all under test. A second
  primitive would be an orphaned-primitive risk of exactly the kind ADR-012 was written to close.

## Consequences

### Positive

- The dedup authority can no longer be silently emptied, by either mechanism.
- Corrupt state becomes loud and immediate instead of inferred later from duplicate work.
- Concurrent mutations are additive; the assessment's top-ranked hardening action is closed.
- A second consumer validates `conduct-state-lease.ts` as a general primitive rather than a
  single-caller helper.

### Negative / trade-offs

- **A corrupt ledger now blocks intake instead of degrading.** Every mutating verb fails until an
  operator intervenes. This is the intended trade — for a dedup authority, refusing is safer than
  proceeding — but it is a genuine availability reduction and needs a documented recovery path.
- Lease acquisition adds latency to every ledger operation and a new failure mode (timeout) to
  callers that previously could only fail on disk errors.
- `conduct-state-lease.ts`'s diagnostics are phrased in terms of "conduct-state"; reused as-is
  they would emit misleading text for the intake ledger, so the primitive must be generalized.
- Read-only methods acquiring the lease means a stuck lease also blocks `list`/`get`, including
  the operator's own inspection verbs. Recovery guidance must account for that.

## Follow-up Actions

- [ ] Document the corrupt-ledger recovery path in the operator runbooks, including how to
      inspect the quarantine copy and how to clear a stuck lease directory.
- [ ] Generalize `conduct-state-lease.ts` naming/diagnostics for multiple consumers.
- [ ] Revisit unifying `Ledger` onto the result-typed store contract as separate work.
