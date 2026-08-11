# Code Duplication Report

**Date:** 2026-08-10
**Scope:** `src/conductor/src/engine/**` (TypeScript engine, ~400k LOC), `bin/conduct` (bash), `skills/*/SKILL.md`. Reviewed via targeted ripgrep sweeps against the focus areas in the assignment, not a file-by-file read of all 1121 `.ts` files.

---

## Duplication Clusters

| # | Pattern | Occurrences | Blast Radius | Extraction Candidate | Notes |
|---|---------|-------------|--------------|---------------------|-------|
| 1 | Ledger read-JSON/write-JSON-atomically shape reimplemented per ledger; one omits atomicity | `engine/kickback-ledger.ts:90-107`, `engine/halt-issues/ledger.ts:148-175`, `engine/engineer/intake/ledger.ts:105-109`, `engine/engineer/authored-ledger.ts:110-126` | high | yes | Divergent behavior, not just copy-paste — see detail |
| 2 | `**Story:**` task-line story-id extraction, 3 independent implementations, 2 distinct regexes | `engine/engineer/coherence-validator.ts:458`, `:702`, `engine/artifacts.ts:3578` | medium-high | yes | Divergent regex whitespace class — see detail |
| 3 | Raw `execa('git', args, {cwd, reject})` invocation with no shared git wrapper | 16 files, 50+ call sites (`engine/worktree-shared.ts`, `engine/autoheal.ts`, `engine/ci-fix.ts`, `engine/autoresolve.ts`, `engine/rebase.ts`, `engine/task-seed.ts`, `engine/shipment-evidence.ts`, +9 more) | high | yes | See detail |
| 4 | `check_X() { has_artifacts "<glob>" }` one-line wrappers in `bin/conduct` | `bin/conduct:730,747,751,755` (`check_brainstorm`, `check_plan`, `check_architecture_diagram`, `check_architecture_review`) | low | no | Each glob is genuinely distinct config, not logic — see notes |
| 5 | `.pipeline/HALT` / `.pipeline/HALT.class` path hardcoded instead of importing `HALT_MARKER`/`HALT_CLASS_MARKER` | `engine/daemon-runner.ts:678-679` vs `engine/halt-marker.ts:14,17` | low | no | Single file, verification-only use — watch item |

### Cluster Detail

#### Cluster 1: Ledger atomic-write pattern reimplemented 4x, one copy drops atomicity

**What it is:** Four independent "small JSON-file ledger" modules each hand-roll: read whole file → `JSON.parse` → mutate in memory → serialize → write back. Three of the four independently reimplement the tmp-file-then-`rename` atomic-write idiom (with their own ad hoc temp-suffix generation); the fourth writes directly with no temp file and no rename.

**Occurrences:**
- `src/conductor/src/engine/kickback-ledger.ts:91-107` — `writeKickbackLedger`: builds `.kickback-ledger.<pid>.<rand>.tmp`, `writeFile` then `rename`, cleans up temp file on error.
- `src/conductor/src/engine/halt-issues/ledger.ts:148-175` (`upsert`) — separately documented "atomic write pattern (tmp-file-then-rename)"; own temp-path/rename implementation (own read of file shows docstring at lines 7-10 restating the same guarantee kickback-ledger.ts implements).
- `src/conductor/src/engine/engineer/intake/ledger.ts:105-109` (`saveStore`) — `${path}.tmp.<randomBytes(4)>`, `writeFile` then `rename`. Third independent copy of the same idiom.
- `src/conductor/src/engine/engineer/authored-ledger.ts:110-126` (`recordAuthoredKey`) — **no temp file, no rename**: `await writeFile(path, JSON.stringify(next, null, 2), 'utf-8')` directly against the live path (line 126). A crash or concurrent read mid-write can observe/leave a truncated or partially-written `authored-keys.json`, unlike the other three ledgers.

**Blast radius:** High — 4 places, crosses the daemon/kickback, halt-issues, and engineer-intake module boundaries, and the divergence is a real correctness gap (silent data-corruption exposure in one of the four).
**Reason:** This is exactly the "divergent implementations of the same behavior" case the persona calls out as more dangerous than plain copy-paste: fixing a corruption/atomicity bug in one ledger does not fix it in the others, and `authored-ledger.ts` currently has weaker guarantees than its siblings with no visible justification in the code.
**Extraction candidate:** Yes — a single `readJsonLedger`/`writeJsonLedgerAtomic` (or similar) helper in a shared module, taking a path and returning/accepting the parsed shape, would let every ledger opt into the same atomicity guarantee and the same corruption-quarantine behavior `halt-issues/ledger.ts` already implements (rename-to-`.corrupt-<ts>` on parse failure — not mirrored in the other three).
**Risk if not extracted:** The next ledger added to this codebase (and there is already a 4-ledger family) has ~75% odds of copying whichever pattern its author happens to see first; `authored-ledger.ts` is proof this has already happened. No single fix location exists for the atomic-write contract.

**Confidence:** 90%, **verified** — read all four write functions directly and confirmed the tmp+rename vs. direct-write divergence by line.

---

#### Cluster 2: `**Story:**` line story-id extraction — 3 implementations, 2 divergent regexes

**What it is:** The plan's `**Story:** <id> (...)` task-line format (used to bind plan tasks to stories/FRs) is parsed independently in three places, two of which live in the *same file* and use two textually different regexes for the identical extraction.

**Occurrences:**
- `src/conductor/src/engine/engineer/coherence-validator.ts:458` — `extractTaskStoryIds` (feeds `checkFrCoverage`, the DECIDE-time FR→story→task coherence gate): `/\*\*Story:\*\*\s*(?:story|epic)?\s*([A-Za-z0-9.\-]+)/gi`.
- `src/conductor/src/engine/engineer/coherence-validator.ts:702` — `extractCitedStoryIdsFromBlock` (feeds `checkOrphanTasks`, the orphan-task gate, same file): `/\*\*Story:\*\*[ \t]*(?:story|epic)?[ \t]*([A-Za-z0-9.\-]+)/gi`.
- `src/conductor/src/engine/artifacts.ts:3578` — `collectPlanCoverage` (feeds the `plan` BUILD-completion criterion, a different module/gate entirely): `/\*\*Story:\*\*\s*(?:story|epic)?\s*([A-Za-z0-9.\-]+)/gi` — matches the first regex, not the second.
- Each site also independently re-implements task-block splitting on `### Task <id>` headings (`coherence-validator.ts:441`, `:671`; `artifacts.ts` via `splitOnHeadings(planText, /^###\s+/)`).

**Blast radius:** Medium-high — crosses two module boundaries (DECIDE-time coherence gate vs. BUILD-time completion check) and the divergence (`\s*` — matches newlines, would tolerate `**Story:**` followed by a line break before the id — vs. `[ \t]*` — same-line only) is a genuine, if narrow, correctness difference between two functions in one file that exist to answer the same question ("what story ids does this task cite").
**Reason:** Two of the three regexes are byte-identical; the third differs only in whitespace class, which is exactly the kind of accidental drift that happens when a pattern is copy-pasted and lightly hand-edited rather than shared. Per the assignment's explicit flag: divergent parsers for one artifact format are a correctness risk, not just style.
**Extraction candidate:** Yes — a single `extractStoryLineIds(blockText)` (and, ideally, a single `splitPlanTaskBlocks(planText)`) in a shared parsing module (e.g. alongside `wired-into.ts`, which already does this correctly for the `**Wired-into:**` format — see note below) would remove both the triplication and the whitespace-class divergence.
**Risk if not extracted:** A future fix to accept a new `**Story:**` authoring variant (as already happened once, per the `story|epic` prefix-stripping logic present in all three copies) requires editing three call sites by hand; missing one silently reintroduces a coverage-gate/completion-check disagreement about which tasks satisfy which stories.

**Confidence:** 88%, **verified** — read all three functions and diffed the regex source text directly; the practical impact of the whitespace-class difference is small (same-line `**Story:**` authoring is the overwhelmingly common case) so I keep this below Cluster 1's confidence on "does this bite in practice," but the triplication itself is fully verified.

**Positive contrast (not a finding):** The sibling `**Wired-into:**` artifact format is *not* duplicated this way — `src/conductor/src/engine/wired-into.ts` exports one `WIRED_INTO_LINE` regex and one parser, imported by `plan-task-parse.ts`, `validate-wired-into.ts`, and `wiring-probe.ts` (confirmed via `wired-into.ts:1-18` and its importers). This is the shape Cluster 2 should be refactored toward.

---

#### Cluster 3: No shared `git` invocation wrapper — raw `execa('git', ...)` across 16 files

**What it is:** `src/conductor/src/execution/subprocess.ts` exports a generic `runCommand(cmd, args, options)` that wraps `execa` with `reject: false`, but it is not used for `git` calls anywhere sampled. Instead, 16 engine files call `execa('git', [...], { cwd, ... })` directly, each choosing its own `reject`/error-handling policy inline.

**Occurrences (representative, not exhaustive):**
- `engine/worktree-shared.ts:61,66,72` — `git worktree add`/`remove`, no `reject: false` (throws on failure).
- `engine/autoresolve.ts:322,338` — `git worktree add --detach` / `remove --force`, same throwing style.
- `engine/autoheal.ts:154,211,220` — `git rev-parse --verify`, `git merge-base --fork-point`, plain `merge-base`.
- `engine/ci-fix.ts:440,448,453` — `git fetch origin`, two `git rev-parse --verify` checks (local/remote branch existence).
- `engine/shipment-evidence.ts:383,395` — `git show`, and a generic args-array call with `reject: false`.
- `engine/rebase.ts:75`, `engine/task-seed.ts:114`, plus `full-suite-fingerprint.ts`, `scope-check-cli.ts`, `shipped-record-cli.ts`, `per-task-commit-floor.ts`, `registry-cli.ts`, `protected-artifact-seal.ts`, `install-freshness.ts`, `daemon-deps.ts` (16 files, 50 call sites total by grep count).

**Blast radius:** High — 6+ files/call sites, crosses many module boundaries (daemon, autoresolve, autoheal, CLI commands, self-host gates), and git invocation is on the critical path for daemon correctness (worktree lifecycle, branch verification, merge-base computation).
**Reason:** Each site independently decides whether to pass `reject: false`, whether to check `.exitCode`, `.failed`, or throw-and-catch, and whether/how to include stderr in error messages. This is exactly the "same behavior, independently reasoned about" pattern — not a bug today (I did not find two sites computing an *observably wrong* answer), but the absence of one `runGit(args, opts)` helper means every future git-invocation policy change (timeout, retry, stderr redaction, env passthrough) has to be hand-applied to 16 files.
**Extraction candidate:** Yes — a thin `runGit(args: string[], opts): Promise<Result>` in `execution/subprocess.ts` (or a new `execution/git.ts`) wrapping the existing `runCommand` would consolidate this without changing behavior at any call site.
**Risk if not extracted:** Low near-term risk (no divergence found), but blast radius is high enough that any git-invocation-wide fix (e.g. #497/#681-adjacent git error handling mentioned in this repo's own daemon-safety rules) has no single edit point today.

**Confidence:** 75%, **verified the call-site count and pattern** (all 16 files confirmed via grep and spot-read); **inferred** the "independently-reasoned error handling" characterization from the small sample read (5 of 16 files), not all 16 — treat the "no divergence found" sub-claim as **tentative** given the sample size.

---

## Watch Items (2 occurrences or low-risk boilerplate — not yet extraction candidates)

| Pattern | Occurrences | Notes |
|---------|-------------|-------|
| `.pipeline/HALT` / `.pipeline/HALT.class` path strings hardcoded instead of importing `HALT_MARKER`/`HALT_CLASS_MARKER` | `engine/daemon-runner.ts:678-679` vs. constants exported at `engine/halt-marker.ts:14,17` (the same file's `writeHaltMarker` is already imported and used one line above, at `daemon-runner.ts:677`) | Single file, post-write verification only (read-back to assert the write landed) — low risk today, but if the marker path ever moves this call site silently breaks while every other reader (`readHaltClass`, `snapshotHaltMarker`) keeps working. Worth a 2-line fix, not worth a "cluster." |
| `check_X() { has_artifacts "<glob>" }` boilerplate in `bin/conduct` | `bin/conduct:730` (`check_brainstorm`), `:747` (`check_plan`), `:751` (`check_architecture_diagram`), `:755` (`check_architecture_review`), `:826` (`check_retro`, via `compgen` directly) | Structurally repetitive but each function's *glob* is the actual content — this is closer to declarative config than duplicated logic. Not flagging as an extraction candidate; a future step-count increase (a `check_X` per new step) would tip this into "should be a table," but at 5 occurrences it reads fine as-is. |
| `mkdtemp`-based fixture setup spread across ~499 test files with no shared `makeTempRepo`/fixture helper found at `test/` top level | `src/conductor/test/**/*.test.ts` (499 files matched `mkdtemp`; only `test/engine/memory-writer-helper.ts` and `test/engine/engineer/intake/_acceptance-helpers.ts` exist as shared helpers, both narrowly scoped) | **Tentative / inferred** — I confirmed the shared-helper directory is sparse and the `mkdtemp` count is large, but did not diff individual test setup blocks to confirm the *same* boilerplate repeats verbatim vs. each test needing genuinely different fixture shape. Flagging as worth cto-testing's attention rather than asserting a duplication finding here. |
| gh CLI invocation | Centralized — no direct `execa('gh', ...)` found outside `engine/tracker-client.ts` and a few CLI-arg-string files (`worktree.ts`, `smoke-capability.ts`, `engineer-cli.ts`, `engineer/handoff.ts`) that reference `'gh'` in prose/flags, not raw invocation | **Not a finding** — checked because the assignment flagged it as a focus area; found no duplication. Recorded so this isn't silently unchecked. |

---

## Summary

**Extraction candidates:** 3 (Clusters 1-3)
**High blast-radius clusters:** 2 (Cluster 1 — ledger atomic-write divergence; Cluster 3 — git invocation, high on file/call-site count though no behavioral divergence confirmed)
**Watch items:** 4

**Verdict: NEEDS_WORK**

- No cluster rises to CRITICAL by the persona's own bar (high blast radius **and** confirmed user-visible/domain-critical divergence) — Cluster 1 is domain-critical (data-integrity of ledgers the daemon depends on) and has a *confirmed* divergence, which puts it right at the CRITICAL boundary; I am holding it at NEEDS_WORK because the affected ledger (`authored-keys.json`, an idempotent append-only dedup set) is lower-stakes than the daemon's primary state files, and I have not verified whether any of the four ledgers has an operational incident on record. Treat Cluster 1 as **near-CRITICAL** and prioritize accordingly.
- Cluster 2 (Story: line parsing) is a real correctness-relevant duplication per the assignment's own criterion ("divergent parsers for one format is a correctness bug"), verified at the code level, with modest practical blast radius today.
- Cluster 3 (git wrapper) is duplication in the classical sense — high occurrence count, no confirmed behavioral bug — the textbook NEEDS_WORK case.

**Key observations (narrative):**
The codebase's disciplined areas (`wired-into.ts` as the single parser for the `Wired-into:` format, `tracker-client.ts` as the single `gh` entry point) show the team already knows how to avoid this class of bug when it's been burned by it once (per this repo's own design-principle commit history around engine-stamped ids and coherence validation). The `**Story:**` line format and the small-ledger-JSON-file pattern have not yet received that same consolidation, and the ledger case already shows the predicted failure mode: one of four independent implementations quietly dropped the atomicity guarantee its siblings maintain. The git-invocation duplication is lower-risk today but is the largest blast radius by file count (16) and sits on the daemon's critical path, so it is the best next target if the goal is reducing future edit-in-16-places risk rather than fixing an existing bug.
