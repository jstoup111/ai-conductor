# Data Integrity Review: ai-conductor

Scope note: there is no SQL database. The durable state is `.pipeline/*.json{,l}`,
`.daemon/*` (pidfile, snapshots, grants, intake ledger/queue), `.docs/` committed
artifacts, and git itself. "Transaction boundaries" is read as *multi-file / multi-step
state changes*, "migration safety" as *persisted-record schema evolution*.

Every row carries a grounded confidence and its basis. `verified` = I read the code and
traced the path. `inferred` = derived from adjacent evidence. Rows marked **tentative**
are below high confidence and must not be treated as confirmed.

---

### Transaction Boundaries

**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/engine/engineer/intake/ledger.ts:95-102` | `loadStore` catches **every** error — including `JSON.parse` failure — and returns `{}`. The very next mutation calls `saveStore`, which persists that empty store over the real file. A single corrupt or truncated byte in the intake ledger therefore does not fail; it silently **erases the sole dedup authority (ADR-012)**, making every previously-`done` intake item re-eligible for re-filing and re-routing. Contrast `src/conductor/src/engine/halt-issues/ledger.ts:113-134`, which quarantines a corrupt ledger to `ledger.json.corrupt-<ts>` and warns — the correct pattern already exists in this repo but was not applied here. Also contrast `state.ts:44-52`, which fails **closed** on corrupt conduct-state. (95%, verified) | **critical** |
| `src/conductor/src/engine/filesystem-conduct-state-store.ts:134-143` | `whileHoldingLease` calls `await mutation()` and then releases — with **no `try/finally`**. Any throw inside the mutation (an unexpected `readState` I/O error, a persistence-layer throw) leaks the lease directory `<state>.lease`. Because the leaking process is still alive, `recoverDeadOwner` (`conduct-state-lease.ts:187-197`) correctly refuses to steal a live owner, so **every subsequent conduct-state mutation for that path fails with `timeout` for the remaining lifetime of the process** — a feature silently stops recording step status. (88%, verified) | important |
| `src/conductor/src/engine/halt-marker.ts:54-58` | `writeHaltMarker` unlinks `HALT.class` **before** writing `HALT`, and `return`s early on any non-`ENOENT` unlink error. A permissions/IO error on the sidecar therefore causes the function to **skip writing the HALT marker entirely** while reporting nothing (the function is documented as best-effort and swallows). The daemon then advances past a condition that should have parked the feature. The ordering also means a crash between line 61 and 63 leaves a `needs-human` HALT readable only as `unclassified`. (90%, verified; the `unclassified` half is mitigated — `daemon-rekick.ts:186` retains `unclassified` like `needs-human`) | important |
| `src/conductor/src/engine/mergeable-sweep.ts:184-193` vs `:123-129` | `rewriteWatch` performs a **non-atomic truncating** whole-file rewrite of `.daemon/mergeable-watch.jsonl`, while `enrollWatch` appends to the same file from a different code path. An enrollment landing between the sweep's `readWatch` and `rewriteWatch` is lost outright — the PR is dropped from the watch registry and is never merged, with no error (both functions swallow all failures). A crash mid-`rewriteWatch` truncates the registry. (90%, verified) | important |
| `src/conductor/src/engine/task-cli.ts:85-150` | Read-modify-write of `.pipeline/task-status.json` (tmp+rename, but **no lock**). Two concurrent `conduct task start` invocations from parallel agents in the same worktree lose one row flip. The engine does run parallel steps (`parallel_started`/`parallel_completed` in `types/events.ts`), so co-occurrence is plausible but I did not trace an actual concurrent call site. **tentative** (65%, inferred) | important |
| `src/conductor/src/engine/shipped-record.ts:299-313` | `writeShippedRecord` overwrites differing content with a plain truncating `writeFile` — the only `.docs/` writer I found that clobbers rather than tmp+renames. Risk is bounded because git commits it immediately and the diff is reviewable, so a torn write is visible rather than silent. (85%, verified) | minor |

---

### Event Sourcing Correctness

**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/engine/event-persister.ts:125` + `timing-rollup.ts:31-34`, `cost-rollup.ts:111-112`, `build-tail-rollup.ts:160-165` | `appendFileSync` with **no `fsync`** and no per-line integrity marker, so a crash (which CLAUDE.md documents as routine — HALTs, live-boundary aborts, killed daemons) can leave a torn final line. Every reader then `catch {}`-drops unparseable lines **silently, with no diagnostic and no count**. Cost, timing, and build-tail rollups therefore under-report on a truncated ledger and there is no way to distinguish a complete ledger from a damaged one. Fail-open silent drop is the wrong default for the system's only telemetry spine. (92%, verified) | important |
| `src/conductor/src/types/events.ts` (whole file, 688 lines) | The `ConductorEvent` union carries **no schema/version field** — `grep` for `version`/`schemaVersion` returns zero hits. The only discriminator is `type`. There is consequently no forward/backward-compatibility contract for `.pipeline/events.jsonl`: renaming a member, or narrowing a closed vocabulary such as `FinishPublicationBlocker` (`events.ts:26-35`) or `FinishPublicationTransition` (`:16-24`), makes historical lines unmappable, and they are then dropped by the same silent catch above. `conduct-state.json` has a real migration path (`state.ts:46` → `migrateState`) and `.daemon/gated.json`/`blocked.json` carry `schemaVersion: 1` with an explicit `kind: 'unknown'` on version mismatch (`gated-snapshot.ts:96`, `:125-131`) — the event spine is the one persisted format with neither. (85%, verified — absence of a version field is verified; the breakage consequence is inferred) | important |
| `src/conductor/src/engine/event-persister.ts:74-143` | Events are appended **after** the state change that produced them, in a separate unsynchronized write, so a crash between a `conduct-state.json` mutation and its event leaves the two permanently inconsistent. There is no reconcile pass that rebuilds state from the event log; the log is telemetry, not the aggregate source of truth, so this is a reporting gap rather than a state-loss gap. (85%, verified) | minor |
| `src/conductor/src/engine/event-persister.ts:38-39, 127-138` | `openSteps`/`openGroups` interval tracking is **in-memory only**. A daemon restart mid-step loses every open interval, so the eventual `step_completed` line is emitted with no `activeInterval` — duration telemetry is silently absent for exactly the steps that crashed, which are the ones worth measuring. (90%, verified) | minor |

---

### Race Conditions

**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/engine/engineer/intake/ledger.ts:122-223` | **No lock of any kind.** Every method (`record`, `transition`, `reopen`, `requeueClaimed`, `forget`) is a full-file read-modify-write across **separate OS processes** — `engineer-cli.ts` constructs a fresh `createLedger(join(engDir,'ledger.json'))` at 7 distinct verb call sites (`:686, 1035, 1087, 1252, 1286, 1330, 1431`) that run as one-shot CLI processes alongside the long-running intake loop. `saveStore` is atomic per-write (tmp+rename, `:105-110`), which makes readers safe but does nothing about lost updates: the loser's write clobbers the **entire store**, not just its own key. A lost `done`/`claimed` transition means the same issue is claimed and routed twice — a duplicate spec PR. This is the sole dedup authority, so lost updates here are the exact failure ADR-012 was written to eliminate. (90%, verified) | **critical** |
| `src/conductor/src/engine/engineer/intake/ledger.ts:124-144` | `known()` and `record()` are separate awaits with no atomic compare-and-set, so the caller's "is it known? no → record and route" sequence is a classic TOCTOU. Two concurrent pollers can both observe `known === false` and both proceed to route. (85%, verified at the primitive; the caller sequence is inferred) | important |
| `src/conductor/src/engine/engineer/intake/queue.ts:105-123` | `claim()` pre-validates **all** pending files and **throws** `Corrupt inbox entry` on the first unparseable one — before any claim rename. One damaged envelope therefore poisons the head of the queue **permanently**: no quarantine path, no skip, no `.corrupt` rename. Every subsequent claim by every process fails the same way, and the whole intake inbox stops draining. The in-code comment justifies this as "surfaces corruption immediately… without losing valid entries", but the effect is total unavailability rather than a single lost entry. (92%, verified) | important |
| `src/conductor/src/engine/engineer/intake/queue.ts:87-92` | `enqueue` writes with a plain truncating `writeFile(..., { flag: 'w' })` directly into the directory that `claim()` scans. A `claim()` racing an in-flight `enqueue` reads a partially written file, fails `JSON.parse`, and triggers the permanent poison above. The atomic-claim design (`rename`) is correct; the *enqueue* side was left non-atomic, which is what feeds it bad input. Fix is a tmp+rename enqueue. (85%, verified code; the interleaving is inferred, not observed) | important |
| `src/conductor/src/engine/daemon-lock.ts:260-272` | `isLive()` decides liveness from the **pid alone** and treats every non-`ESRCH` error as alive. The per-boot `uuid` exists in `PidRecord` (`:56-78`) and is used by `ownsLock` (`:541-544`) but is never consulted in the liveness decision. A recycled pid therefore keeps a dead daemon's lock alive indefinitely, and `reclaim` (`:347-349`) refuses forever. Low probability on a normal host; the conservative bias is deliberate and documented. **tentative** (70%, verified code / inferred impact) | minor |
| `src/conductor/src/engine/daemon-lock.ts:713-723, 750-759` | `ensureRunning` acquires the O_EXCL pidfile, immediately unlinks it, and then spawns — a window in which no lock exists at all. The `transient` marker (#374) closes the *reader* half of this race, and the spawned daemon's own `holdLock` re-arbitrates, so at-least-one is preserved. Recorded as reviewed-and-sound rather than a defect. (90%, verified) | — |
| `src/conductor/src/engine/conduct-state-lease.ts:163-267` | Reviewed in full: directory-`mkdir` mutex, `wx` owner file, liveness-proven recovery with a recovery-claim + quarantine-and-reconfirm sequence, and explicit refusal on ambiguous ownership. This is the strongest concurrency primitive in the codebase and I found no defect in it. (90%, verified) | — |

---

### Data Migration Safety

**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/types/events.ts` | No version field on any persisted event (see Event Sourcing above) — there is no migration mechanism at all for the event spine, and no test that an old `.pipeline/events.jsonl` remains readable. Unknown *fields* survive (readers pick named fields), but unknown/removed **variants** are silently dropped rather than preserved or reported. (85%, verified absence) | important |
| `src/conductor/src/engine/kickback-ledger.ts:67-88` | Deliberately fails **open**: corrupt or unsupported-version ledgers reset to an empty budget with only a `console.warn`. That converts a corruption event into an unbounded rework/kickback loop — the exact budget the ledger exists to enforce. Documented as intentional, so this is a design trade-off to revisit, not an oversight. (90%, verified) | minor |
| `src/conductor/src/engine/state.ts:44-52`, `:55-63` | Positive: `readState` fails closed on corrupt/empty state, and `migrateState` provides an idempotent, non-destructive forward migration (`brainstorm` → `explore` + `prd`). This is the pattern the event spine and the intake ledger lack. (95%, verified) | — |
| `src/conductor/src/engine/gated-snapshot.ts:96, 125-131`; `daemon-backlog.ts:626-634` | Positive: `.daemon/gated.json` and `blocked.json` both stamp `schemaVersion: 1`, write atomically, and classify an absent/corrupt/future-shaped snapshot as an explicit `kind: 'unknown'` that callers must render as "state unknown" rather than "nothing gated". Correct fail-closed read semantics. (92%, verified) | — |

---

### Backup and Recovery

**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `.gitignore:4,7,8` | `.pipeline/`, `.daemon/`, and `.worktrees/` are all gitignored, and I found no backup, snapshot, or export mechanism for any of them. Git is the durability substrate **only** for `.docs/`. Everything the daemon needs to resume correctly — the intake ledger and queue, `conduct-state.json`, task-status, the evidence sidecar, grants, HALT markers — has exactly one copy on one disk with no retention and no restore path. (90%, verified) | important |
| CLAUDE.md "Daemon Operations Safety" #3 (#497) vs. `src/conductor/src/engine/task-evidence.ts:74-113` | **Still prose-only — no machinery.** `createTaskEvidence` reads `.pipeline/task-evidence.json` from the worktree root and returns *empty state* when it is missing; deleting `.worktrees/<slug>` therefore silently resets `evidenceStamps`, `noEvidenceAttempts`, and `lastResolvedCount`, which is precisely the documented false-`no_task_progress` stall. I searched for a recreate-time backfill (`grep -rn "backfill"` across `src/conductor/src`) and every hit is either intake-label backfill or the shipped-record audit — none reconstruct task evidence from the branch. The interim prose rule in CLAUDE.md is still the only guard. (85%, verified) | important |
| `src/conductor/src/engine/halt-issues/ledger.ts:113-134` | Positive and worth replicating: the only ledger in the repo that quarantines a corrupt file (`ledger.json.corrupt-<ts>`) and warns before rebuilding. (95%, verified) | — |
| `src/conductor/src/engine/daemon-backlog.ts:790-882`, `shipped-record.ts:294-320`, `shipment-audit.ts` | **CLAUDE.md #4 (#438) now has machinery.** Content-aware shipped-work dedup reads committed `.docs/shipped/*.md` off the base-branch tree, plus a pre-merge feature-branch check, so a recorded ship is durably deduped rather than re-dispatched forever. This documented corruption mode appears resolved. The remaining gap is the *manual* PR that never gets a shipped-record at all — nothing reconciles a merge back into `.docs/shipped/`. (85%, verified) | — |
| everywhere except `filesystem-conduct-state-store.ts:65-70` | **No `fsync` anywhere else, and no directory `fsync` after any `rename`.** `gated-snapshot.ts:100-102`, `daemon-backlog.ts:632-634`, `kickback-ledger.ts:105-106`, `intake/ledger.ts:108-109`, `task-cli.ts:143-145` all tmp-write + rename without syncing either the file contents or the parent directory. On a power loss this can lose the rename or expose a zero-length file — which, for the intake ledger, escalates into the critical wipe above. `createAtomicPersistence` (`filesystem-conduct-state-store.ts:85-116`) is the one correct implementation (write → `sync` → close → rename) and is still missing the directory sync. (90%, verified) | minor |

---

### Summary

**Overall Verdict:** NEEDS_WORK

**Critical findings:** 2
**Important findings:** 12
**Minor findings:** 7

**Critical findings detail:**

- `src/conductor/src/engine/engineer/intake/ledger.ts:95-102` — `loadStore` swallows JSON parse failure and returns `{}`; the next `saveStore` writes that empty store over the file, **silently destroying the entire intake dedup authority (ADR-012)** and making every completed intake item re-eligible. The repo already has the right pattern (quarantine-and-warn) at `halt-issues/ledger.ts:113-134`. (95%, verified)
- `src/conductor/src/engine/engineer/intake/ledger.ts:122-223` — the "sole dedup authority" has **no locking**, and is mutated by full-file read-modify-write from at least 7 separate one-shot CLI processes (`engineer-cli.ts:686,1035,1087,1252,1286,1330,1431`) concurrently with the intake loop. A lost `transition` clobbers the whole store, not one key, and produces duplicate claims/routes for the same issue. Note the contrast with `conduct-state`, which solved exactly this with `conduct-state-lease.ts` — the primitive exists and is simply not used here. (90%, verified)

**Out of scope, flagged for `cto-security`:** none encountered.
