# Stories: Phase 9.1 — Structured Retro Signal + Engineer Memory Store

**Status:** Accepted
**Source PRD:** `.docs/specs/2026-06-25-phase-9.1-retro-signal-engineer-memory.md`
**Complexity tier:** M
**Persona note:** "I" is the **daemon** (the producer). The **operator** / future **engineer** is
the eventual reader of the store. Scenarios are expressed in terms of the engineer store files
(`~/.ai-conductor/engineer/signals.jsonl`, `narratives/`), the feature's `events.jsonl`,
`FeatureOutcome`, and `.pipeline` — there is no HTTP/UI surface.

---

## Story: Emit one signal on daemon feature completion

**Requirement:** FR-1

As the daemon, I want to emit exactly one structured signal when a feature finishes, so the
engineer has a per-feature record to learn from.

### Acceptance Criteria
#### Happy Path
- Given a daemon feature completes with outcome `done`, when emission runs, then exactly one new
  line is appended to the engineer store's signals log for that feature.
- Given a daemon feature completes with outcome `halted`, when emission runs, then exactly one
  signal line is appended (outcome=`halted`).

#### Negative Paths
- Given a feature is built via a **manual `/conduct`** run (not the daemon), when it completes,
  then **no** signal is emitted to the engineer store.
- Given emission runs for a single completion, when it finishes, then it appends **exactly one**
  record (no duplicate line for the same completion).

### Done When
- [ ] Daemon `done` and `halted` completions each append one signal line; manual runs append none.
- [ ] Test: daemon outcome → 1 line; manual outcome → 0 lines.

---

## Story: Engineer store location, override, and creation

**Requirement:** FR-2

As the operator, I want the store at the harness's user-config location (overridable), so it's
predictable, outside any repo, and the future engineer can find it.

### Acceptance Criteria
#### Happy Path
- Given no override is set, when the daemon emits, then it writes under
  `~/.ai-conductor/engineer/` (beside `~/.ai-conductor/config.yml`).
- Given the override env/config (e.g. `$AI_CONDUCTOR_ENGINEER_DIR`) is set, when the daemon emits,
  then it writes under that path instead.
- Given the engineer dir does not exist yet, when the daemon emits, then it is created.

#### Negative Paths
- Given any emission, when the target path is resolved, then it is **never** inside the feature's
  project repo / worktree (assert the resolved path is outside the project root).

### Done When
- [ ] Default path `~/.ai-conductor/engineer/`; override honored; dir auto-created.
- [ ] Test: resolved store path is outside the project root in all cases.

---

## Story: Write the structured signal record

**Requirement:** FR-3

As the future engineer, I want each signal to be a versioned, well-formed JSON line, so the store is
machine-aggregable.

### Acceptance Criteria
#### Happy Path
- Given a completion, when the signal is written, then the line is valid JSON with fields
  `{schemaVersion, ts, project, feature, runId, outcome, kickbacks[], halts[], retryHotspots[],
  tokens{input,output,cacheRead,cacheCreation}, durationByStep{}, narrativeRef}`.
- Given the schema evolves later, when a record is written, then it carries the current
  `schemaVersion`.

#### Negative Paths
- Given a feature with **no** kickbacks/halts/retries, when the signal is written, then those
  fields are present as **empty arrays** (not missing/null) so readers can aggregate uniformly.
- Given a feature with **no narrative** (retro step skipped — see FR-5), when the signal is
  written, then `narrativeRef` is **optional** (absent/null) and the record still validates.
- Given any record, when parsed, then every line in the log independently parses as JSON (no
  partial/merged lines).

### Done When
- [ ] Record matches the schema; empty signal categories serialize as `[]`; `schemaVersion` set.
- [ ] Test: parse each emitted line → conforms to schema; zero-signal feature → empty arrays.

---

## Story: Assemble the signal from existing sources

**Requirement:** FR-4

As the daemon, I want to derive the signal from data the loop already produces, so I add no new
instrumentation.

### Acceptance Criteria
#### Happy Path
- Given a feature's `events.jsonl` contains `kickback`, `loop_halt`, `step_completed`
  (tokenUsage), retries, and `rebase_*` events, when the signal is assembled, then `kickbacks[]`,
  `halts[]`, `retryHotspots[]`, `tokens`, and `durationByStep` are populated from them +
  `FeatureOutcome`.
- Given the report-renderer's aggregation, when assembling, then durations/retries/token-spend
  reuse that logic (not a parallel re-implementation).

#### Negative Paths
- Given a feature whose `events.jsonl` is missing or empty (edge), when assembly runs, then it
  produces a record with the known fields from `FeatureOutcome` and empty signal arrays — it does
  **not** throw.
- Given a malformed line in `events.jsonl`, when assembly runs, then that line is skipped and the
  rest are aggregated (resilient parse).

### Done When
- [ ] Fields populate from events.jsonl + FeatureOutcome + report-renderer aggregation.
- [ ] Test: missing/empty/malformed events.jsonl → record still produced, no throw.

---

## Story: Done feature → full retro narrative in the store

**Requirement:** FR-5

As the future engineer, I want the full retro narrative for a completed feature stored centrally
(not in the repo), so I can read the human-judgment interpretation later.

### Acceptance Criteria
#### Happy Path
- Given a daemon feature with outcome `done`, when emission runs, then the full retro narrative is
  written to `~/.ai-conductor/engineer/narratives/<project>/<feature>.md` and `narrativeRef` in the
  signal points to it.

#### Negative Paths
- Given a `done` feature, when emission runs, then the retro narrative is **not** written to the
  project repo's `.docs/retros/` (assert the repo path is absent/unchanged).
- Given the narrative file already exists from a prior run, when emitting again, then the prior
  narrative is **not** silently overwritten (versioned per `runId` — see FR-8).
- Given a daemon feature whose complexity tier **skipped the retro step** (e.g. Small tier, per
  ST-005), when emission runs, then the signal is **still** emitted with the structured fields and
  `narrativeRef` is **absent/null** — no narrative is fabricated, and emission never depends on a
  retro having run. (Resolves the FR-5/6 × ST-005 gap.)

### Done When
- [ ] Done → narrative in store narratives dir; `narrativeRef` resolves to it; repo `.docs/retros/` untouched.
- [ ] Retro-skipped done feature → signal emitted, `narrativeRef` absent, no error.
- [ ] Test: done feature → store narrative present, repo retro absent; tier-skipped → signal, no narrativeRef.

---

## Story: Halted feature → short halt narrative in the store

**Requirement:** FR-6

As the future engineer, I want a brief "why it halted" narrative for halted features, so I can learn
halt patterns.

### Acceptance Criteria
#### Happy Path
- Given a daemon feature with outcome `halted`, when emission runs, then a **short** halt
  narrative (the halt gate + why) is written to the store narratives dir and referenced by
  `narrativeRef`.

#### Negative Paths
- Given a `halted` feature, when emission runs, then it does **not** attempt a full feature retro
  (which would be meaningless on incomplete work) — only the short halt narrative is produced.
- Given a halt with no captured reason (edge), when the narrative is written, then it records the
  halt gate and a "reason unavailable" note rather than failing.

### Done When
- [ ] Halted → short halt narrative in store; no full retro; `narrativeRef` set.
- [ ] Test: halted feature → short narrative present, references the halt gate/reason.

---

## Story: Daemon writes no retro into the project repo

**Requirement:** FR-7

As the operator, I want daemon-built features to leave the project repo free of retro clutter, so
repos stay clean and the narrative lives in the engineer's state.

### Acceptance Criteria
#### Happy Path
- Given a daemon feature completes (done or halted), when the worktree is inspected, then no new
  retro file exists under the project's `.docs/retros/`.

#### Negative Paths
- Given a **manual `/conduct`** run completes, when inspected, then the repo retro behavior is
  **unchanged** (manual runs still write `.docs/retros/` as before — the redirect is daemon-only).

### Done When
- [ ] Daemon runs: repo `.docs/retros/` gets no new file; manual runs: unchanged.
- [ ] Test: daemon vs manual divergence on repo retro output.

---

## Story: Re-run retains history (run-id keyed)

**Requirement:** FR-8

As the future engineer, I want a feature's re-runs preserved as distinct records, so I can see how a
feature's signals changed across attempts.

### Acceptance Criteria
#### Happy Path
- Given a feature emitted once, when the daemon re-runs and re-emits it, then a **second** signal
  record with a new `runId` is appended, and the first record is retained.
- Given two runs, when narratives are written, then each run's narrative is preserved (keyed/
  versioned by `runId`), not overwritten.

#### Negative Paths
- Given a re-emission, when it runs, then it does **not** corrupt or truncate the prior record/
  narrative (append-only; prior content intact).

### Done When
- [ ] Re-run → new runId record + preserved prior; narratives not overwritten.
- [ ] Test: two emissions of same feature → 2 records, both narratives present.

---

## Story: Signals support cross-feature rate metrics

**Requirement:** FR-9

As the future engineer, I want the stored fields to be sufficient to compute kickback/halt/retry
rates across features and projects, so we can tell whether the system is learning.

### Acceptance Criteria
#### Happy Path
- Given a set of signal records across features/projects, when a reader computes kickback rate,
  halt rate, and retry rate, then the required fields (`outcome`, `kickbacks[]`, `halts[]`,
  `retryHotspots[]`, `project`, `feature`) are present and typed to support that computation.

#### Negative Paths
- Given records from mixed projects, when aggregating, then `project`/`feature` keys disambiguate
  them (no cross-project collision merges distinct features).

### Done When
- [ ] A test computes kickback/halt/retry rates from fixture records using only stored fields.
- [ ] Test: per-project aggregation keeps distinct features distinct.

---

## Story: Emission is best-effort (never breaks a ship)

**Requirement:** FR-10

As the operator, I want a learning-signal write failure to never break a real feature ship, so
the store is strictly additive value.

### Acceptance Criteria
#### Happy Path
- Given the store is writable, when a feature completes, then the signal is written and the
  feature completes/ships normally.

#### Negative Paths
- Given the engineer dir is **unwritable** (permission/disk error), when emission runs, then the
  error is **logged and swallowed**, the daemon does **not** throw, and the feature still
  completes (PR for `done`, park for `halted`) — `FeatureOutcome` is unaffected.
- Given narrative write fails but the signal line succeeds (or vice versa), when emission runs,
  then the partial failure is logged and does not abort feature completion.

### Done When
- [ ] Unwritable store → emission logged + swallowed; feature completion/PR/park unaffected.
- [ ] Test: inject a write failure → no throw, FeatureOutcome unchanged, warning logged.

---

## Story: Append-safe under concurrency

**Requirement:** FR-11

As the daemon running features in parallel, I want concurrent emissions to never corrupt the
signals log, so the store stays parseable.

### Acceptance Criteria
#### Happy Path
- Given `--concurrency > 1` with multiple features finishing near-simultaneously, when they emit,
  then the signals log contains one well-formed JSON line per feature with **no interleaved/
  torn** lines.

#### Negative Paths
- Given N concurrent emissions, when all complete, then the log has **exactly N** valid lines and
  every line parses as JSON (no partial writes, no merged records).

### Done When
- [ ] Concurrent emissions produce N intact, individually-parseable lines (atomic record append).
- [ ] Test: simulate ≥2 concurrent emissions → N valid JSON lines, none corrupted.
