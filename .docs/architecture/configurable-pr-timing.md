# Architecture: Configurable push/PR timing

**Last updated:** 2026-07-03
**Scope:** One config key, `pr_timing: finish | early-draft` (default `finish`), governing
WHEN a branch is pushed and its PR opened in BOTH publish flows: the daemon's implementation
build and the engineer's spec authoring. `finish` is byte-for-byte today's behavior.

## Component view — config resolution and the two publish flows

```mermaid
flowchart TD
  cfg["project config -- repo/.ai-conductor/config.yml -- pr_timing key"]
  validate["validateConfig -- fail-closed: unknown value rejects load"]
  resolver["resolvePrTiming -- resolved-config.ts -- absent or undefined -> finish"]

  cfg --> validate --> resolver

  subgraph publisher["Shared publish seam -- PrPublisher"]
    push["pushBranch -- force-with-lease aware"]
    draft["findOrCreatePr -- draft:true -- pr-labels.ts"]
    ready["markReadyForReview -- pr-labels.ts"]
  end

  selfhost["SelfHostDetector -- self-host build forces effective mode finish -- loud downgrade log"]
  resolver --> selfhost --> daemonFlow
  resolver --> engineerFlow

  subgraph daemonFlow["Daemon build flow -- Conductor.run"]
    buildStart["build step dispatch"]
    stepDone["loopGate step completes"]
    rebaseStep["native rebase step -- history rewrite"]
    finishStep["finish step -- /finish skill"]
  end

  subgraph engineerFlow["Engineer spec flow"]
    author["DECIDE skill boundary -- artifact written"]
    land["engineer land -- commit .docs set"]
    handoff["engineer handoff -- spec PR"]
  end

  buildStart -->|"early-draft: push + draft PR"| publisher
  stepDone -->|"early-draft: refresh push"| publisher
  rebaseStep -->|"early-draft: push --force-with-lease"| publisher
  finishStep -->|"early-draft: markReadyForReview -- /finish reuses existing PR"| ready
  finishStep -->|"finish mode: /finish pushes + gh pr create -- unchanged"| unchanged["current behavior"]

  author -->|"early-draft: checkpoint commit + push + draft spec PR"| publisher
  land -->|"both modes: authoritative .docs commit"| handoff
  handoff -->|"early-draft: markReadyForReview"| ready
  handoff -->|"finish mode: push + gh pr create -- unchanged"| unchanged
```

## Structural invariants

1. **Default is inert.** `pr_timing` absent or `finish` → zero behavior change in both
   flows; the `/finish` prompt augmentation and `engineer handoff` publish exactly as today.
2. **Fail-closed validation.** An unrecognized `pr_timing` value rejects config load
   (owner-gate `owner_gate_cutover` precedent) — a typo must never silently pick a mode.
3. **One resolver, two consumers.** Timing is resolved once (`resolvePrTiming`,
   `resolved-config.ts` pattern) and read via `Conductor.config` / the engineer command
   context; neither flow re-reads the file mid-run.
4. **Publishing reuses the escalation seam.** Early pushes and draft PRs go through the
   existing `findOrCreatePr({draft})` / push code paths (`pr-labels.ts`,
   `build-failure-escalation.ts` pattern) — no second gh-invocation implementation.
5. **History rewrite is contained.** Only the post-rebase refresh may force-push, and only
   `--force-with-lease`; every other push is a plain fast-forward push.
6. **`land` stays authoritative.** Engineer early-draft checkpoint commits never replace
   the `land` gate: artifact guards (C2, DRAFT-ADR, tier match) still run at `land`, and
   the spec PR is marked ready only at `handoff`.
7. **Advisory, never blocking.** A failed early push / draft-PR creation logs loudly and
   the build/authoring continues; only the finish-time publish remains load-bearing.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE for configurable-pr-timing (ai-conductor#199) |
| 2026-07-03 | Added SelfHostDetector downgrade on the daemon path | Conflict-check resolution (adr-2026-07-03-pr-timing-self-host-precedence) |
