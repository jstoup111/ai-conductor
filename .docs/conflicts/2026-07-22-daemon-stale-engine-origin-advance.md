# Conflict Check: daemon-stale-engine-origin-advance

**Date:** 2026-07-22
**New stories:** `.docs/stories/daemon-stale-engine-origin-advance.md`
**Result:** CLEAN — zero blocking, zero degrading conflicts.

Corpus: 181 story files scanned by machinery keyword
(`fastForwardRoot|publish-engine|stale engine|rebuildEngine|engine-source-key|quiescent`);
the matched neighbors were each examined pairwise against the new stories. Confidence
grounding per pair below (verified = contradicting/compatible text read directly).

## Pairs examined

1. **`daemon-build-start-base-refresh` (Accepted, #598-sibling)** — refreshes a *feature
   worktree's base branch* before BUILD via the custom-step framework; the new stories
   refresh the *daemon's own root checkout/engine* at the quiescent gate. Different git
   trees, different artifacts, explicitly recorded as separate tracks in that spec's own
   context ("#598 … kept as a separate track"). Both fetch `origin/<default>` — benign
   duplicate reads, no shared mutable state. **No conflict (verified, ~95%).**

2. **`engine-rebuild-content-cache` (#715, Accepted)** — `publish()` skips the tsup build
   entirely on a source-key cache hit. Interaction reasoned through: after a successful
   fast-forward, engine-relevant source changes → cache miss → full rebuild → new version →
   checker sees drift. The new TI-3 stamp fires only on publishes that *finalize a version*,
   and TI-3's "skip-path no-churn" negative path matches #715's skip semantics exactly. A
   cache-hit return of a pre-feature version without a SHA sidecar reads as "unknown"
   (fail-closed) per TI-3. **Compatible (verified, ~90%).**

3. **`2026-07-03-daemon-auto-restart-stale-engine` (Accepted, founding gate stories)** —
   the new refresh step is inserted *inside* the same quiescent gate, before the existing
   rebuild; gate arming, checker semantics, suppression, and restart contract are asserted
   unchanged by the new stories (TI-1 negative paths restate them). Additive, not
   contradictory. **No conflict (verified, ~95%).**

4. **`daemon-restart-leaves-the-daemon-stopped-when-orig` (#353) +
   `fix-400-stale-engine-respawn-in-place-stacks-daemo` (#400)** — restart *transport*
   contracts (remain-on-exit, single-generation handoff, lock release). New stories
   explicitly leave the transport untouched and depend on it only as a consumer. **No
   conflict (verified, ~95%).**

5. **`rekick-resume-republish-stale-worktree-engine` (#625, shipped)** — republishes the
   *per-worktree* engine on re-kick resume; the new stories cover the *root* engine. Same
   defect class, disjoint engine copies and trigger points; #625's stories were written to
   deliberately exclude this case. **No conflict (verified, ~90%).**

6. **`2026-07-10-stale-engine-residuals-369` / `reenable-bin-setup-worktree-smoke` /
   others matched by keyword** — matched on incidental vocabulary only (residual cleanup,
   smoke tests); no shared behavior surface with the new stories. **No conflict
   (verified, ~90%).**

## Observations (non-conflicts, forwarded to /plan)

- The TI-4 advisory probe (non-self-host / flag-off) needs origin knowledge and therefore a
  fetch; the plan must place that fetch under the same TI-2 throttle so the advisory path
  cannot become an unthrottled fetch loop. Stories are compatible as written — this is a
  mechanism placement note, not a contradiction.
- `overlap-scan` (run during architecture-review) flags ~20 unmerged spec branches touching
  `engine/daemon.ts`; expect routine rebase conflicts at build time, none structural.

## Verdict

Conflict check passed. Proceed to `/plan`.
