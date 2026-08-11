# ADR: The checkout is the sole version-identity authority

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture-review for #1437

## Context

`check_harness_update_tagged` (`bin/update:126-180`, duplicated byte-for-byte at
`bin/conduct:345-374`) resolves the installed harness version in two branches: the exact
checked-out tag if HEAD is a tag, otherwise the `currentVersion` recorded in config. Nothing
ever re-checks the recorded value against the checkout it claims to describe.

When the checkout has advanced past the recorded tag **and** that tag equals the newest
released tag, `semver_lt` is false, the function stamps `lastCheckedAt`, and returns. The
install reports "up to date" indefinitely — with no output at all.

**Reproduced directly** (100% confidence, executed): a scratch checkout two commits past
`v0.100.0`, with `currentVersion=v0.100.0` and latest tag `v0.100.0`, produced **zero output
and exit 0**. The live operator install is in this state at 22 commits past `v0.100.0`.

Forces at play:

- The recorded value is written by `bin/install:883-902` `detect_current_version`, which when
  off-tag falls back to the `VERSION` file (`0.100.0` → `v0.100.0`). This directly contradicts
  `bin/update:133-136`'s own comment that `VERSION` "intentionally advances immediately after
  a release, so neither it nor a stale config value can identify the installed tagged
  release." The installer writes precisely the guess the update path refuses to make.
- In-flight #1400 seeds the legacy JSON **over** the `conductor:` block and renames the legacy
  file to `.migrated`. Whatever identity is authoritative at that moment becomes permanent, so
  a wrong value recorded today would outlive any repair-on-write fix.
- The silence is the actual harm: an install that has quietly stopped surfacing releases —
  including migrations — is indistinguishable from a current one.

## Options Considered

### Option A: Contradiction detector (narrow)
Keep the existing resolution order. When falling back to the record, test whether the checkout
provably contradicts it (`merge-base --is-ancestor` plus a non-zero commit count) and report
the contradiction instead of concluding "current".

- **Pros:** Smallest diff. Leaves every existing accepted test intact. No contract renegotiation.
- **Cons:** Keeps the record as fallback authority, so a wrong frozen record (guaranteed by
  #1400's seed) degrades the check to "cannot determine" rather than fixing it. Preserves an
  "unverifiable" outcome that exists only because the code has no vocabulary for the
  post-release state. Leaves `bin/install` writing the bad value. Treats one symptom of an
  unfalsifiable record rather than the record's authority.

### Option B: The checkout is the only authority; the record is a write-only cache
Derive a structured identity from the checkout on every run — baseline release, distance from
it, and whether it is determinable at all. Never read the record to decide anything; continue
writing it so downstream consumers and #1400's seed carry a correct value.

- **Pros:** One uniform rule covering ahead, behind, and detached states. Identity source is
  always the checkout, so the "which identity and where from" requirement falls out for free.
  Structurally immune to #1400's seed — it does not matter which store the record lives in or
  what it holds. Gives the post-release state a name (`«tag»+N`) instead of collapsing it into
  a false claim or an unhelpful "unverifiable". No new config key.
- **Cons:** Renegotiates the `#1005` "unverifiable" contract and rewrites two accepted test
  assertions (see `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`). Deletes the
  deliberate between-tags fallback the existing code comment defends.

### Option C: Record the resolution sha alongside the version
Persist `currentVersion` plus the sha it was resolved at; trust the record only while HEAD
equals that sha.

- **Pros:** Staleness becomes structurally impossible rather than merely detected. No git
  archaeology. The record keeps a meaningful role.
- **Cons:** Requires a **new config key**, which lands directly on the schema surface #1400 and
  #1412 are actively rewriting. Buys a hard dependency on unmerged work to fix a bug that is
  live today. Needs a migration for existing installs.

## Decision

**Option B.** Version identity is derived from the checkout on every invocation; the persisted
`currentVersion` has no read-authority anywhere in the update flow.

The reasoning is not that B is the smallest fix — it is not. It is that the defect is not a
stale value but an **unfalsifiable** one: a record that nothing compares against the thing it
describes. A detects one way that record goes wrong; B removes the record's authority so it
cannot go wrong. Option A also leaves the check depending on exactly the value #1400 is about
to freeze, which means A's correctness degrades the moment that unrelated work merges. C
reaches the same guarantee as B but pays for it with a schema change on contested ground.

**Resolution mechanism (decided here, refining the design artifact).** Identity is computed as:

| Step | Command | Result |
| --- | --- | --- |
| baseline | `git tag --merged HEAD -l 'v*.*.*' --sort=-v:refname \| head -1` | highest **reachable** release tag, or empty |
| distance | `git rev-list --count «baseline»..HEAD` | 0 = exactly at the release; N > 0 = post-release |

`git describe --tags --long` was the design artifact's original mechanism and is **rejected**
here for two verified reasons: it returns the *nearest* ancestor tag rather than the *highest
reachable* one (these diverge in merge histories, understating the baseline), and its default
`--candidates=10` limit is already exceeded — the live checkout has **22 reachable v-tags**
(verified). `git tag --merged` is semver-ordered, has no candidate limit, and needs no string
parsing. Both mechanisms agree on the current checkout (`v0.100.0`, distance 22), so this is a
robustness refinement, not a behavior change.

Identity states:

| baseline | distance | kind | identity (printed) | compared as |
| --- | --- | --- | --- | --- |
| present | 0 | release | `«tag»` | `«tag»` |
| present | N > 0 | post-release | `«tag»+N` | `«tag»` |
| empty / git failure | — | undeterminable | `unknown` | not compared |

`«tag»+N` is deliberately **not** a claim to be `«tag»`. That vocabulary is what the current
code lacks.

Behavioral commitments (operator-confirmed):

- Every invocation of the check — including every `bin/update --auto` spawned at conduct-ts
  startup — prints one line naming the identity and its source. Verified reachable: the
  spawner uses `stdout: 'inherit'` (`auto-update-check.ts:21-22`).
- Report and offer; never move the checkout without an explicit y/n consent.
- A post-release checkout whose baseline already equals the latest tag reports "N commits past
  «tag», no newer release exists" — it never returns silently.
- The record continues to be written so a correct value is what #1400's seed makes permanent.
- Channels remain `tagged` and `main` only.

> **Amended 2026-08-09 by #1437 (same DECIDE pass, during `/stories`):** what gets **persisted**
> is the **baseline**, never the display identity. `bin/migrate:60-73` reads `currentVersion` as
> `FROM_VERSION` and `bin/migrate:328-331` validates it against `^v?[0-9]+(\.[0-9]+)+$`. A
> display value like `v0.100.0+22` fails that regex and falls into the "channel identity such as
> `main@«sha»`" branch, which treats the value as having no sortable lower bound and uses
> `TO_VERSION` as its own baseline — **silently skipping every migration block in between**
> (verified by reading both call sites). Persisting the baseline `v0.100.0` keeps `bin/migrate`
> byte-for-byte correct and is also semantically right: a checkout at `v0.100.0+22` genuinely
> has every migration up to `v0.100.0`. Therefore:
>
> - **release** (distance 0) → persist `«tag»`.
> - **post-release** (distance N > 0) → persist `«tag»` (the baseline), **not** `«tag»+N`.
> - **undeterminable** → persist nothing; do not guess (preserves desired outcome 4).
>
> `«tag»+N` remains the **printed** identity. Display and record are deliberately different
> shapes: the record is a semver lower bound for migration math, the display is a truthful
> statement of where the checkout sits.

## Consequences

### Positive
- The class of bug where a recorded identity disagrees with the checkout becomes unreachable,
  not merely detected.
- Correctness no longer depends on which config store holds the record, so #1400/#1412 can
  land in either order without interaction.
- `bin/install` stops guessing identity from `VERSION`, removing the defect at its origin.
- Placing the resolver in `bin/lib/harness-common.sh` makes the `bin/conduct` mirror a call
  rather than a second copy of the logic, shrinking what #226 later has to delete.

### Negative
- Two accepted `#1005` assertions are rewritten (covered by the companion ADR).
- Every check now costs two extra `git` invocations. Negligible against the existing
  `git fetch --tags`, but it is not free.
- The always-printed identity line adds one line to every conduct-ts and daemon-loop startup.
  The operator explicitly chose this over a quieter manual-loud/auto-quiet variant.
- The fix must be applied twice until #226 removes `bin/conduct`'s duplicate.

### Follow-up Actions
- [ ] Add `resolve_harness_identity` to `bin/lib/harness-common.sh` as the single resolver.
- [ ] Rewrite `check_harness_update_tagged` in `bin/update` to use it; mirror into `bin/conduct`.
- [ ] Remove the `VERSION`-file fallback from `bin/install:883-902` `detect_current_version`.
- [ ] Extend the always-printed identity line to `check_harness_update_main`.
- [ ] Update `docs/reference/cli.md` / `docs/reference/configuration.md` in the same PR.
