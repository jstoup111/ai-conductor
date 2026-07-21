# Track: skip the per-dispatch engine tsup rebuild when engine source is unchanged

Track: technical

Daemon/engine internal build tooling — no end-user-facing product behavior; acceptance criteria
live in stories. Source-Ref: jstoup111/ai-conductor#715.

## Problem statement

Every (re)dispatch runs the project's `bin/setup` in the feature worktree, whose `npm run build`
is `node scripts/publish-engine.mjs`. `publish-engine` **always** runs the tsup build (npm install
+ tsup + DTS, ~2-3 min) into a staging dir, and only *after* the build finishes does it compute a
content SHA of the build **output** and log `content unchanged (<sha>) — publish skipped` to avoid
the finalize+flip. The expensive build that *discovers* "nothing changed" runs unconditionally —
54 full `Setup complete` builds in one day's daemon log, including re-dispatches of the same
feature minutes apart. The existing SHA guard saves the symlink flip, not the build.

## Desired outcome

Re-dispatching a feature whose engine-relevant **source** is unchanged skips the redundant tsup
build entirely (cache by a source-content key), while a genuinely-changed engine still rebuilds.

## Candidate (filer's hypothesis, not the chosen approach)

Compute a content key over the engine build inputs *before* running tsup and short-circuit when it
matches the last successful build. Carried into DECIDE as a candidate; the WHAT is the latency win,
not this specific seam.

## Correctness boundary (do NOT regress — #625/#598)

#625/#598 are engine-staleness bugs. The cache key MUST be the engine-relevant **source** content
so any real engine change always rebuilds, and the mechanism MUST **fail open** to a full rebuild on
any doubt (absent/corrupt cache, missing current version, dangling `dist`, any hash/read error). A
cache that ever serves a stale engine is strictly worse than no cache. Out of scope: skipping
`npm install`, changing the versioned dist-versions/dist-symlink layout, or the post-build
output-SHA idempotence guard (kept as a second safety net).
