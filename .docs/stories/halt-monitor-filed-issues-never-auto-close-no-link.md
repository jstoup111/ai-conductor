**Status:** Accepted

# Stories: halt-monitor issue auto-close (deterministic closure sweep)

Technical track — acceptance criteria derived from APPROVED
`adr-2026-07-08-halt-issue-closure-sweep` and review conditions C1 (quota/local-first),
C2 (conservative closure), C3 (DI isolation). Requirement tags reference ADR decision
points (D1 ledger, D2 stamping, D3 closure, D4 quota, D5 scope).

## Story: Verdict parser extracts filed issues from monitor.log

**Requirement:** ADR D1

As the operator, I want every `HALT <slug> -> filed #N` verdict in monitor.log turned
into a ledger entry so that the slug→issue linkage is machine-readable.

### Acceptance Criteria

#### Happy Path
- Given a monitor.log containing a multi-paragraph RESULT line with `HALT my-slug -> filed #416` embedded mid-text, when `conduct-ts halt-issues sweep --dry-run` runs, then the parse output includes an entry `{ slug: "my-slug", issue: 416 }`.
- Given one RESULT line containing TWO verdicts (`HALT a -> covered by #417` and `HALT b -> filed #415`), when the parser runs, then exactly one ledger entry (issue 415, slug b) is produced — `covered by` verdicts are ignored.
- Given a ledger that already contains issue 415, when the sweep re-parses the same monitor.log, then no duplicate entry is created and the existing entry's fields are unchanged (idempotent upsert keyed by issue number).
- Given daemon-log/monitor-log NEW HALT lines with ISO timestamps for a slug, when its entry is created, then `haltAt` equals the newest halt timestamp for that slug at parse time.

#### Negative Paths
- Given a RESULT line with malformed verdict text (`HALT -> filed #` with no slug/number), when the parser runs, then the line is skipped, the summary reports `unparseable: 1`, and the exit code is still 0.
- Given a monitor.log that does not exist at the configured path, when the sweep runs, then it exits 0 with summary `no monitor.log — nothing to do` and performs zero GitHub calls and zero ledger writes.
- Given a verdict whose issue number belongs to a different repo context (ledger configured for `jstoup111/ai-conductor`), when parsed, then the entry records `repo: "jstoup111/ai-conductor"` from configuration, never inferred from free text.

### Done When
- [ ] Parser unit tests pass against a fixture copied from the REAL monitor.log excerpts (multi-verdict RESULT, embedded verdict, covered-by lines).
- [ ] `sweep --dry-run` on the fixture prints planned entries without writing the ledger file.
- [ ] Re-running sweep twice over the same fixture produces byte-identical ledger content.

## Story: Ledger is atomic, rebuildable, and survives corruption

**Requirement:** ADR D1

As the operator, I want the ledger at `~/.ai-conductor/halt-issues/ledger.json` to be a
disposable cache so that losing or corrupting it never loses linkage.

### Acceptance Criteria

#### Happy Path
- Given new entries to persist, when the ledger is written, then the write goes to a temp file in the same directory followed by rename (atomic), and the resulting JSON parses with schema `{ version, entries: { "<issue>": { issue, repo, slug, haltAt, status, stampedAt?, closedAt?, closedBy?, lastError? } } }`.
- Given a deleted ledger file, when `conduct-ts halt-issues sweep` next runs, then the ledger is rebuilt from monitor.log parsing and (for stamped/closed state) the current GitHub issue state of each ledgered issue, restoring `status: closed` for issues already closed.

#### Negative Paths
- Given a ledger file containing invalid JSON, when the sweep runs, then the corrupt file is preserved as `ledger.json.corrupt-<timestamp>`, a fresh ledger is rebuilt, the summary reports the recovery, and exit code is 0.
- Given the ledger directory is unwritable, when the sweep runs, then it reports the error on stderr, performs NO GitHub writes that cycle (state could not be recorded), and exits non-zero — the monitor loop tolerates the non-zero exit (hook line is `|| true`-guarded in the documented hook).

### Done When
- [ ] Tests demonstrate atomic write (no partial file visible under simulated crash between temp-write and rename), rebuild-from-scratch, and corrupt-file quarantine.
- [ ] Ledger path is injected in tests (C3); no test touches the real `~/.ai-conductor`.

## Story: Deterministic Halt-Slug stamping on filed issue bodies

**Requirement:** ADR D2

As the operator, I want every ledgered issue body to carry `Halt-Slug: <slug>` so that
the linkage survives ledger loss and is consumable by other tools (#355, intake dedup).

### Acceptance Criteria

#### Happy Path
- Given a ledgered open issue whose body lacks a `Halt-Slug:` line, when the sweep runs, then the body is updated once via the gh seam appending `Halt-Slug: <slug>` on its own line, and the entry records `stampedAt`.
- Given an issue whose body already contains `Halt-Slug: <slug>` (stamped by a prior run or manually), when the sweep runs, then no body edit is performed and `stampedAt` is set from observation.

#### Negative Paths
- Given the gh body-edit call fails (network/auth), when stamping, then the failure is recorded in that entry's `lastError`, other entries still process, the summary counts the failure, and exit code is 0 (per-entry non-fatal).
- Given a ledgered issue that was deleted/transferred (gh view returns not-found), when the sweep runs, then the entry is marked `status: closed`, `closedBy: "external"` and never retried.
- Given an issue already stamped with a DIFFERENT slug (`Halt-Slug: other-slug`), when the sweep runs, then the body is NOT modified, the conflict is recorded in `lastError`, and the entry is excluded from auto-close (linkage ambiguous — human resolves).

### Done When
- [ ] Fake-gh tests cover stamp-if-absent, observe-if-present, per-entry failure isolation, and the conflicting-stamp exclusion.
- [ ] A stamped body round-trips: the sweep's own reader recognizes its stamp format.

## Story: Close on ship evidence with recurrence guard

**Requirement:** ADR D3 (condition C2)

As the operator, I want issues closed automatically when their slug demonstrably
shipped after the halt so that resolved halt issues stop accumulating.

### Acceptance Criteria

#### Happy Path
- Given an open ledgered issue for slug S, and `.daemon/processed/S` containing `{"status":"shipped","prUrl":"https://github.com/.../pull/399"}` with mtime newer than S's newest halt timestamp, when the sweep runs, then it posts a marker-tagged comment "Auto-closed by halt-issues sweep: `S` shipped in <prUrl>. Reopen (or label `halt-sweep:keep-open`) if this issue tracks a broader gap.", closes the issue, and sets `status: closed, closedBy: "sweep", closedAt`.
- Given ship evidence only as `.docs/shipped/S.md` with a `pr:` value and a shipped date newer than the newest halt, when the sweep runs, then closure proceeds identically (either evidence source suffices).

#### Negative Paths
- Given ship evidence OLDER than the newest halt event for S (halt recurred after ship), when the sweep runs, then the issue stays open and the summary lists it as `guarded (recurred)`.
- Given a processed marker with `"prUrl": null`, when the sweep runs, then the issue stays open (no evidence link to offer — C2's false-ship discipline).
- Given the issue carries the `halt-sweep:keep-open` label, when the sweep runs, then no comment, no close, and the entry is reported `kept-open (label)` — permanently exempt while labelled.
- Given the resolved-by comment posts successfully but the close call fails, when the sweep next runs, then the comment is NOT duplicated (marker-tagged upsert) and the close is retried.
- Given the issue was already closed manually, when the sweep runs, then no comment is posted, no close attempted, and the entry records `status: closed, closedBy: "external"`.
- Given a halt for S cleared (`.pipeline/HALT` gone / `HALT.cleared` present) but NO ship evidence exists, when the sweep runs, then the issue stays open and is reported `unresolved (cleared-no-ship)` — never auto-closed.

### Done When
- [ ] Fake-gh + injected-state tests cover every branch above, including timestamp comparison at the boundary (evidence mtime == halt time → guarded, strict `>` required).
- [ ] The closing comment body in tests matches the documented format exactly (single source constant).

## Story: Quota discipline — zero steady-state GitHub calls

**Requirement:** ADR D4 (condition C1)

As the operator (with a history of REST-quota exhaustion), I want sweeps to be free
when nothing changed so that a 180 s monitor cycle never polls GitHub.

### Acceptance Criteria

#### Happy Path
- Given a ledger where every entry is stamped and either closed or lacking new ship evidence, when the sweep runs, then the fake gh runner records ZERO invocations.
- Given one entry that just became closable, when the sweep runs, then gh calls are limited to that entry: at most one state read plus the comment upsert, close, and (if needed) label read for it.

#### Negative Paths
- Given 50 open entries none of which have local ship evidence, when the sweep runs, then zero gh calls occur (local filesystem checks alone decide "not yet").
- Given `--dry-run`, when entries WOULD be stamped/closed, then zero gh WRITE calls occur and the planned actions are printed.

### Done When
- [ ] A call-counting fake gh runner asserts the zero-steady-state and per-transition bounds.
- [ ] No timer, watcher, or polling loop exists in the sweep (single pass, exits).

## Story: CLI surface, backfill run, and monitor hook documentation

**Requirement:** ADR D5

As the operator, I want `conduct-ts halt-issues sweep` invocable standalone (backfill)
and from the monitor loop (one hook line) so that today's stale issues get cleared and
future ones never accumulate.

### Acceptance Criteria

#### Happy Path
- Given the real monitor.log content, when `conduct-ts halt-issues sweep --dry-run` runs the first time (backfill), then the plan lists entries for the historically filed issues (#297, #300, #302, #354, #358, #385, #386, #403, #407, #415, #416) with per-issue dispositions (close / guarded / kept-open / already-closed).
- Given a completed sweep, when it exits, then stdout's final line is a single summary `halt-issues sweep: parsed N, stamped S, closed C, guarded G, errors E` (machine-greppable for the monitor log).
- Given the docs, when the feature lands, then README/src/conductor/README document the subcommand, its flags (`--dry-run`, `--repo-dir`, `--gh-repo`, `--monitor-log`, `--ledger`), and the exact one-line hook to add to monitor.sh (`conduct-ts halt-issues sweep || true`), noting monitor.sh itself is out-of-repo (#355).

#### Negative Paths
- Given `gh` is unauthenticated, when the sweep runs, then parsing and ledger upserts still complete, all GitHub-dependent actions are skipped with `lastError` recorded, exit code is 0, and the summary shows `errors: N` (the monitor loop is never broken by the sweep).
- Given an unknown flag, when invoked, then the CLI exits non-zero with usage text (no partial run).
- Given a second sweep starts while one is running (overlapping monitor cycles), when both attempt ledger writes, then the atomic rename discipline means the ledger is never left partially written; last-writer-wins is acceptable and documented (single-operator tool).

### Done When
- [ ] `conduct-ts halt-issues sweep --help` documents all flags; unknown flags exit non-zero.
- [ ] Backfill dry-run output against a fixture of the real monitor.log matches the 11 historical issues.
- [ ] README + src/conductor/README updated in the same PR (docs-track-features rule); CHANGELOG `[Unreleased]` entry present.
- [ ] Real-binary smoke test: the built conduct-ts binary runs `halt-issues sweep --dry-run` against a fixture directory end-to-end (no mocked argv — per injected-runner lesson).

## Story: Test isolation and no real side effects

**Requirement:** Review condition C3

As the maintainer, I want the sweep fully DI'd so that tests can never touch real
GitHub, real `~/.ai-conductor`, or spawn real processes.

### Acceptance Criteria

#### Happy Path
- Given the sweep module, when constructed in tests, then gh runner, monitor.log path, ledger path, repo state dirs, and clock are all injectable; production wiring lives only in the CLI entry.

#### Negative Paths
- Given the vitest env kill-switch is set (global setup), when any sweep test runs, then no real `gh` process can spawn (guarded spawn seam) — a test attempting it fails loudly rather than silently hitting the network.

### Done When
- [ ] All sweep tests pass with `rtk proxy npx vitest run` in the worktree with network-dependent seams faked.
- [ ] Zero test writes outside injected temp dirs.
