# Stories — port-self-update-flow

Status: Accepted

Track: technical. Acceptance criteria are **behavioral-equivalence** assertions:
`bin/update` must reproduce the observable behavior of the current
`bin/conduct` update/channel flow (327–470). Each story cites the behavior it
preserves.

---

## Story 1 — Force an update check (replaces `conduct --update`)

**As** a harness consumer, **I want** to run an update check on demand **so that**
I can pull the latest harness without waiting for an auto-check.

- **Given** `HARNESS_DIR` is a git repo and channel is `tagged`
  **When** I run `bin/update`
  **Then** it fetches tags, and if a newer `vX.Y.Z` tag exists it renders the
  changelog range and prompts to update — identical to `conduct --update` today.
- **Given** the harness is already at the latest version
  **When** I run `bin/update`
  **Then** it writes `lastCheckedAt`, prints nothing alarming, and exits 0.

**Negative** — **Given** `HARNESS_DIR` is not a git repo (`.git` absent)
**When** I run `bin/update` **Then** it exits 0 without error (mirrors the
`[ -d "${HARNESS_DIR}/.git" ] || return 0` guard).

---

## Story 2 — Set the update channel (replaces `conduct --set-channel`)

**As** a consumer, **I want** to switch between `tagged` and `main` **so that** I
can choose stable releases or bleeding edge.

- **Given** any state **When** I run `bin/update --set-channel main`
  **Then** `updateChannel` is written as `main` in `ai-conductor.config.json`, it
  prints "Update channel set to: main", and exits 0.
- **Given** any state **When** I run `bin/update --set-channel tagged`
  **Then** `updateChannel` becomes `tagged` and it exits 0.

**Negative** — **Given** any state **When** I run `bin/update --set-channel bogus`
**Then** it prints an invalid-channel error naming the valid values and exits **2**
(mirrors `set_update_channel`'s validation).

---

## Story 3 — Tagged-channel update happy path

**As** a consumer on `tagged`, **I want** to be prompted and updated to the latest
tag **so that** I move only on approved releases.

- **Given** channel `tagged`, current `v0.3.0`, latest tag `v0.4.0`, a TTY
  **When** the check runs and I answer `y`
  **Then** it renders the `v0.3.0`→`v0.4.0` changelog range, checks out
  `tags/v0.4.0`, runs `bin/migrate`, writes `currentVersion=v0.4.0` +
  `lastCheckedAt`, and reports success.
- **Given** I answer `n` **Then** no checkout happens and it logs "Skipping update".

**Negative (rollback)** — **Given** the update is approved but `bin/migrate` fails
**When** the flow runs **Then** it prints the failure, runs
`git checkout <rollback_ref>` to restore the previous ref, and returns non-zero —
`currentVersion` is **not** advanced.

---

## Story 4 — Main-channel update happy path

**As** a consumer on `main`, **I want** fast-forward pulls with migrate **so that**
I track every merge.

- **Given** channel `main`, HEAD is an ancestor of `origin/<branch>` and behind by
  N>0 commits, a TTY, I answer `y`
  **When** the check runs **Then** it `git pull --ff-only`, runs `bin/migrate`,
  writes `currentVersion=main@<sha>`, and reports success.

**Negative** — **Given** HEAD is **not** an ancestor of `origin/<branch>` (diverged)
**When** the check runs **Then** it returns 0 without attempting a pull (mirrors the
`merge-base --is-ancestor` guard) — no destructive action on a diverged branch.

---

## Story 5 — No-TTY guidance (non-interactive)

**As** a consumer running in a non-interactive context, **I want** printed manual
instructions instead of a blocking prompt.

- **Given** an available update but no TTY (`[ ! -t 0 ]`)
  **When** the check runs **Then** it prints the exact manual command
  (`cd <HARNESS_DIR> && git checkout <tag> && bin/migrate`, or the `git pull`
  variant on `main`) and returns 0 without prompting.

---

## Story 6 — First-run version seeding

**As** a consumer with no recorded tagged version, **I want** silent seeding
**so that** I am not prompted to "update" to my current state.

- **Given** channel `tagged` and `currentVersion` empty or `main@*`
  **When** the check runs **Then** it silently writes `currentVersion=<latest tag>`
  and returns 0 with no prompt (mirrors the seed branch).

---

## Story 7 — Auto-check preserved after `bin/conduct` removal

**As** a consumer, **I want** the harness to still check for updates on every run
once `bin/conduct` is gone.

- **Given** `autoCheck=true` **When** `conduct-ts` starts
  **Then** it spawns `bin/update --auto`, which performs the same channel-dispatched
  check as today before the pipeline boots.
- **Given** `autoCheck=false` **When** `conduct-ts` starts / `bin/update --auto` runs
  **Then** the check is a silent no-op (mirrors the `auto_check=false` early return).

**Negative** — **Given** `bin/update` is missing or errors at startup
**When** `conduct-ts` spawns it **Then** the failure is logged and swallowed; the
pipeline still boots (advisory, never blocking).

---

## Story 8 — Changelog range rendering

**As** a consumer, **I want** to see what changed between my version and the target.

- **Given** an available update and a configured `markdown_viewer`
  **When** the prompt is shown **Then** the changelog blocks strictly between the
  current version (exclusive) and target (inclusive) are rendered via the viewer,
  reverse-chronological, `Unreleased` excluded — identical to
  `render_changelog_range` today.
- **Given** no matching changelog blocks **Then** rendering is skipped silently.

---

## Story 9 — Documentation reflects the new mechanism

**As** a consumer reading the docs, **I want** HARNESS.md and READMEs to describe
`bin/update`, not the removed `bin/conduct` functions.

- **Given** the PR **When** it lands **Then** HARNESS.md 286–307 describes
  `bin/update` / `bin/update --set-channel` / `bin/update --auto`; the README and
  `src/conductor/README.md` mention the new command surface; and CHANGELOG carries
  a `## Migration` block mapping the old flags to the new script.
