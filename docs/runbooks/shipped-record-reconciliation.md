# Shipped record reconciliation

Land the missing `.docs/shipped/<slug>.md` for work that already shipped, so the daemon stops
re-dispatching it. For operators who finished a feature by hand.

**A manual PR is not a harness finish.** Opening and merging a PR yourself tells the daemon
nothing. The only thing that records a ship is a committed shipped record on the base branch.

## Symptom

- The daemon keeps dispatching a feature whose implementation is already merged.
- `conduct-ts daemon park <slug>` is the only thing holding it back — and you have to keep it
  parked forever.
- The startup dashboard lists the slug under ELIGIBLE even though its PR shows as merged.
- `conduct-ts shipment-evidence --pr <url>` exits 1 with a `shipped-record-*` code.

Parking is a stopgap, not a finish. A parked feature is one you can never unpark, and its park
marker is indistinguishable from a deliberate operational hold.

## Diagnosis

### 1. Is the record on the base branch?

The dedup check reads shipped records **only** from the base-branch tree — via
`git ls-tree <base-branch>:.docs/shipped` and `git show <base-branch>:<path>`. A record that
exists in your working tree, or on an unmerged branch, is invisible by construction.

```bash
git ls-tree --name-only <base-branch>:.docs/shipped | grep "<slug>"
git show <base-branch>:.docs/shipped/<slug>.md
```

`<slug>` is the plan file stem: `.docs/plans/<slug>.md` → `<slug>`.

### 2. Is the record well-formed?

A valid record starts with a frontmatter block, exactly:

```yaml
---
slug: <slug>
spec_hash: <sha256-hex>
pr: <pr url | local>
shipped: <YYYY-MM-DD>
---
```

The parser requires line 0 to be exactly `---`, a closing `---`, and non-empty `slug` and
`spec_hash`. Anything else parses as malformed. A malformed record still dedups **by stem** — it
just cannot dedup a renamed spec by content hash.

### 3. Ask the verifier

```bash
conduct-ts shipment-evidence --pr <implementation-pr-url>
```

| Output | Meaning | Exit |
| --- | --- | --- |
| `shipped-record: valid <path>` | Record present and bound to this PR. | 0 |
| `shipped-record: not applicable (<class>)` | This PR is not an implementation PR for a plan. | 0 |
| `shipped-record: <refusal-code>` | Named defect — e.g. `shipped-record-missing`, `shipped-record-not-in-candidate`, `shipped-record-incomplete`, `shipped-record-hash-mismatch`. | 1 |

The evaluator deliberately refuses to infer a successful ship from merge state alone. A merged PR
with no record is a defect, not a ship.

### 4. Check the daemon's local ledger

```bash
cat .daemon/processed/<slug>
```

`{"status":"shipped","prUrl":"…"}` means the daemon has already recorded the ship locally. This
cache is a fast path, not the authority — the base-branch record is. A missing cache entry
alongside a present base-branch record is harmless; the daemon repairs the cache the first time
the dedup fires.

## Recovery

Pick the branch that matches where the implementation is. Every one of them ends in
`conduct-ts shipped-record`, so read this first — it applies to all of them.

> **Known limitation — do not trust the exit code.** `conduct-ts shipped-record` is
> degrade-never-block by contract: *any* failure (unreadable plan, ambiguous candidates,
> filesystem error, git error) prints one warning — `shipped-record write failed — dedup degraded
> to local cache for <slug>: <reason>` — and **exits 0**. A clean exit does not mean a record was
> written, and dedup silently falls back to the local `.daemon/processed/` cache, which a later
> daemon on another checkout does not see. Always verify with `git cat-file -e` (see
> [Verification](#verification)). Tracked in [#1023](https://github.com/jstoup111/ai-conductor/issues/1023).

### The implementation branch has not merged yet

This is the normal path and the cheapest one. Run the command **in the implementation worktree,
on the implementation branch**, before the final push:

```bash
cd .worktrees/<slug>
conduct-ts shipped-record --slug <slug> --pr <implementation-pr-url>
```

**What it changes:**

1. Resolves the plan identity — `.docs/plans/<slug>.md` exactly, else exactly one
   `.docs/plans/YYYY-MM-DD-<slug>.md` candidate. Two candidates is `ambiguous`; zero is
   `missing`. It never guesses.
2. Hashes the plan bytes plus its stories file (the plan's `**Stories:**` reference first, else
   `.docs/stories/<slug>.md`) into `spec_hash`.
3. Renders the record, appending a Cost block when a cost rollup is available: `input`,
   `output`, `cache_read`, `cache_creation`, `cost_usd`, `dispatches`, `retries`, `halts`,
   `unmetered`, and a per-provider breakdown.
4. Writes `.docs/shipped/<slug>.md`, `git add`s it, and commits `shipped record: <slug>` with
   `--no-verify` — but **only if the staged diff is non-empty**. Re-running with identical
   content prints `✓ shipped record already committed: <path>` and creates no duplicate commit.

Use `--pr local` instead of a URL for a merge-local finish. Never run it for a `keep` or
`discard` finish — those did not ship.

> **Known limitation.** The Cost block's `halts:` field is structurally always `0`. The rollup
> counts `loop_halt` events from `.pipeline/events.jsonl`, but `loop_halt` is one of the 28 of 57
> event types the engine emits and never registers as readable, so it never reaches that file.
> The zero is written verbatim into every committed shipped record and re-read by `conduct-ts
> kpi` — a halt count of 0 in a shipped record proves nothing about whether the feature halted.
> Read `.pipeline/HALT` and the daemon log instead. The per-provider breakdown is written but
> never surfaced: `conduct-ts kpi` has no parser for the `providers:` lines.
> Tracked in [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

Then push, and merge the PR. The record rides in with the code, so the merge lands the
implementation and the shipped fact atomically:

```bash
git push
```

### The implementation PR is already merged

Do not commit a record onto the base branch by hand. Use the reconciler, which branches off
`main`, writes only the record, and never mutates main:

```bash
export GITHUB_REPOSITORY=<owner>/<repo>
conduct-ts shipment-evidence reconcile --pr <implementation-pr-url> --shipped <YYYY-MM-DD>
```

**What it changes:** creates `shipment-repair/<pr-number>/<slug>` off `main`, commits exactly one
file (the write is asserted to be a `.docs/shipped/*.md` path — anything else throws), opens or
finds the matching repair PR, re-verifies the evidence at the immutable repair head, and posts a
`shipped-record` commit status carrying the verdict. The injected publisher surface offers no
merge, approve, or auto-merge operation — a human merges the repair PR.

`--shipped` must match `YYYY-MM-DD`. `GITHUB_REPOSITORY` is required; without it the run throws
`GITHUB_REPOSITORY is required for repair publication`.

| Output | Meaning | Exit |
| --- | --- | --- |
| `shipped-record: aligned` | Nothing to repair. | 0 |
| `shipped-record: repair-published` | Repair branch and PR exist; merge it. | 0 |
| `shipped-record: unresolved` | The defect is not one of the repairable record codes. | **1** |

**Blast radius:** none on `main` — the repair only ever exists on its own branch until you merge
it. **Confirm:** the repair PR exists and its head carries a `shipped-record` commit status of
`success`.

### Hold the line while you fix it

Park the slug so the daemon stops burning dispatches during the repair, and unpark once the
record is merged:

```bash
conduct-ts daemon park <slug>
# …land the record…
conduct-ts daemon unpark <slug>
```

Ordering rules are in
[emergency stop a running feature](emergency-stop-a-running-feature.md).

If the implementation PR is already merged (the case this section is under), landing the record
is usually enough on its own: the daemon's [parked-feature reconciliation
sweep](../guides/running-the-daemon.md#parked-feature-reconciliation) detects the merged branch
plus the newly-committed record on its next idle tick and removes the worktree, deletes the
branch, and unparks the slug automatically — `daemon unpark` is then unnecessary. Run
`conduct-ts daemon reconcile-parked <slug>` to do the same thing immediately instead of waiting
for the next tick, or if `reconcile_parked_auto_cleanup` is set to `false`.

### The spec was renamed after it shipped

You do not need a second record. The daemon runs two dedup passes: a stem match, then a
content-hash match that compares the candidate's freshly computed `spec_hash` against every
committed record's. A renamed spec whose plan and stories bytes are unchanged still dedups, and
the local cache is repaired under the **new** slug.

If the plan or stories content changed, the hash no longer matches and the candidate is a
genuinely different spec — it will be dispatched, correctly.

## Verification

Verify the record, then verify that the dedup actually took. The first without the second is the
mistake this runbook exists to prevent.

### The record is committed

```bash
git cat-file -e "HEAD:.docs/shipped/<slug>.md" && echo "record committed"
```

This is the check the `finish` flow itself trusts, precisely because the command's exit code is
not trustworthy. Run it in the worktree whose branch you committed on.

### The record is on the base branch

```bash
git show <base-branch>:.docs/shipped/<slug>.md
```

Until the PR merges, this fails — and until it succeeds, the daemon cannot see the record at all.

### The record parses and binds to the PR

```bash
conduct-ts shipment-evidence --pr <implementation-pr-url>
```

Expect `shipped-record: valid <path>` and exit 0.

### The dedup actually fired

Two independent signals, both on the next daemon poll after the merge:

1. The daemon log carries the skip line:
   ```bash
   conduct-ts daemon logs --lines 200 | grep "shipped dedup"
   ```
   Expect `skip <slug>: shipped dedup — implementation already merged (base-branch shipped
   record found); not re-dispatching.` — or, for a renamed spec, `skip <slug>: shipped dedup —
   shipped under '<stem>', candidate '<slug>' matches by content (spec_hash); not
   re-dispatching.`

   This message is logged **once** and suppressed thereafter by a `.daemon/warned/<slug>`
   marker. Its absence from a later log is not evidence of failure — use signal 2.

2. The local processed cache was repaired:
   ```bash
   cat .daemon/processed/<slug>
   ```
   Expect `{"status":"shipped","prUrl":"<url>"}`. The daemon writes this when the base-branch
   dedup fires, so its presence proves the dedup ran.

### The slug leaves the eligible set

```bash
conduct-ts daemon logs --lines 60
```

In the startup dashboard the slug must appear under PROCESSED — not ELIGIBLE, and not PARKED.
If it is still PARKED, you have not unparked it, and the park is masking whether the dedup works.
Unpark and re-check.

Do not verify a ship by reading the record's `halts:` count — it is always `0` regardless of what
happened. See the known limitation in Recovery.

Related: [stalled or stuck feature](stalled-or-stuck-feature.md) when the feature never reached a
ship at all, and [daemon recovery](daemon-recovery.md) when the re-dispatch loop is a daemon
fault rather than a missing record. Artifact-by-artifact detail is in
[artifacts](../reference/artifacts.md).
