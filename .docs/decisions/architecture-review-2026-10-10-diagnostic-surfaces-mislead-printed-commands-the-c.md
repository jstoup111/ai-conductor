# Architecture Review: Diagnostic surfaces mislead — rejected remediation commands and non-durable episode HALT state

**Date:** 2026-10-10
**Mode:** Lightweight (Tier M) — §2 Technical Feasibility and §4 Architectural Alignment only
**Stories reviewed:** none yet (pre-stories, technical track). Input: `.docs/track/diagnostic-surfaces-mislead-printed-commands-the-c.md`
(binding scope boundary), `.docs/complexity/diagnostic-surfaces-mislead-printed-commands-the-c.md`, and the
approved `.docs/architecture/diagnostic-surfaces-mislead-printed-commands-the-c.md`.
**Verdict:** APPROVED

## Feasibility

### Item 1 — every printed remediation command is one the CLI accepts

Verified on the spec base (confidence 95%, read directly): the bare-form guard in
`src/conductor/src/index.ts` (`detectInline(process.argv)` → `isInline` false → exit 1) rejects any
invocation without the `inline` subcommand. The intake named two strings; reading the file shows
**six** guidance strings in `index.ts` that print a bare form the guard rejects:

| Site (rediscovery hint) | Printed today | Accepted form |
|---|---|---|
| orphaned-state message in the `--diagnose` branch | `ai-conductor --reset` | `ai-conductor inline --reset` |
| orphaned-state worktree-missing message | `` `ai-conductor --reset` `` | `ai-conductor inline --reset` |
| SHIP-evidence gap report ("To roll back feature_status…") | `ai-conductor "<feature>"` | `ai-conductor inline "<feature>"` |
| same gap report ("To inspect raw state") | `ai-conductor --status` | `ai-conductor inline --status` |
| "No changes made" recovery-declined message | `ai-conductor --status` | `ai-conductor inline --status` |
| same message ("To start over") | `ai-conductor --fresh "<feature>"` | `ai-conductor inline --fresh "<feature>"` |

The scope boundary ("every remediation command the conductor CLI prints") covers all six; fixing only
the two named in the intake would leave the defect class open. This is within the confirmed breadth,
not an expansion. The guard's own guidance (`conduct inline "<feature description>"`, `conduct inline
--status | …`) and the `--auto` deprecation (`ai-conductor daemon start`) are already accepted forms.

- **Stack:** plain TypeScript in `src/conductor/src`; no new dependency. A builder module plus vitest
  tests.
- **Parse proof:** the builder's outputs are tokenized and fed through the real grammar —
  `detectInline` (the guard's decision) and `parseArgs` (`src/conductor/src/cli.ts`) — so "accepted"
  means the same code path the operator's shell invocation takes. Subcommands dispatched before the
  guard (e.g. `daemon start`) are accepted by their own dispatch; the builder's closed command set
  must state which grammar proves each entry.
- **Source check:** a test-tier scan rejects command literals of the form `ai-conductor …` /
  `conduct …` inside guidance strings in `index.ts` that do not come from the builder. Scope is the
  conductor CLI entry module named in the track; other modules are out of scope.
- **Prerequisites / data / performance / worktree isolation:** none.

### Item 3 — episode-caused HALT recovery survives a daemon restart

Verified (confidence 95%): stamps live only in an in-memory `Set`
(`engine/episode-halt-tracker.ts`); `sweepEpisodeHalts` / `recoverEpisodeHalts` read only that
tracker; the episode-end sweep fires only on the in-process was-active→inactive edge
(`DaemonMaintenance.afterIdlePoll`). After a restart nothing is stamped and no edge occurs, so no
recovery happens.

- **Stack:** filesystem sidecar under the feature worktree's `.pipeline/`; no new dependency.
- **Prerequisites:** `RateLimitEpisode` exposes `active()` but not its deadline; a read-only deadline
  accessor is needed for the stamp (verified from the interface, confidence 90%).
- **Data implications:** one small file per stamped halted worktree. Lifecycle reuses
  `writeHaltMarker` (already unlinks the class sidecar before a new body) and `clearMarker` (already
  removes the class sidecar) — verified in `engine/halt-marker.ts` / `engine/daemon-rekick.ts`.
- **Worktree isolation / self-host live boundary:** the sidecar is under `.worktrees/<slug>/.pipeline/`,
  an excluded path for the live-boundary fingerprint — no false self-host halt (CLAUDE.md rule 5).
- **Performance:** idle-tick recovery reads one file per halted worktree only while no episode is
  active; negligible.

## Alignment

**Governing ADRs (reused, not duplicated):**
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator` — the episode stays in-process; its accepted
  consequence ("episode state is lost on restart") remains true for the episode. Its premise that
  startup re-discovery recovers work does not hold for HALTed features; the new ADR records that and
  makes only the HALT stamps durable. No amendment to the 07-05 ADR is required because none of its
  decisions is reversed.
- `adr-2026-07-28-total-halt-classification-legacy-boundary` — D4's sidecar lifecycle is applied to
  the new sidecar; D1's closed writable class set is preserved (Option C rejected precisely to avoid
  overloading it).
- Operator-park and operator-action precedence in today's `recoverEpisodeHalts` is preserved.

**Event spine:** the stamp is durable state (exception C), read by name like `HALT.class`. No new
event type, no new ledger, no reconstruction from `events.jsonl`. Item 1 adds no channel.

**Machinery over discipline (CLAUDE.md):** item 1 replaces six hand-typed strings with a builder plus
a mechanical parse proof and a source check; item 3 replaces an implicit in-memory invariant with
durable state and a digest validity check. Both match the design principle.

**State management:** stamp validity is explicit (present + digest match + deadline passed + no
operator precedence), not a boolean flag; a missing or invalid stamp fails toward "leave for a human".

**Production DI defaults:** item 3 removes an in-memory production default for stateful data
(the tracker `Set`) in favor of a filesystem store — exactly what §4's production-DI check asks for.

**Diagram accuracy:** the approved diagram reflects the design. One refinement from this review: the
recovery trigger is "startup and idle ticks while no episode is active" (ADR decision 4), which the
diagram's startup-sweep and episode-end-sweep nodes both express.

**Security boundaries:** no new endpoints or inputs; the sidecar is written and read only by the
daemon in the feature worktree.

**Pattern basis (focused, local):** the new sidecar mirrors the `HALT.class` sidecar — role: durable
per-HALT fact; traits to preserve: removed before a new HALT body is written, removed on clear,
absence fails safe; allowed variation: content is structured (deadline + digest) rather than a class
token; rediscovery hints: `HALT_CLASS_MARKER`, `writeHaltMarker` in `engine/halt-marker.ts`,
`clearMarker` in `engine/daemon-rekick.ts`.

## Wiring Surface

| New / changed surface | Production caller (design-time commitment) |
|---|---|
| Remediation-command builder module (new, `src/conductor/src`) | Called from each of the six guidance sites in `src/conductor/src/index.ts` listed above, on the existing `inline --diagnose` / orphaned-state / recovery-declined paths |
| Builder parse test + guidance-literal source check (new tests) | Run by the default vitest tier under `test_suite`; not production code |
| `HALT.episode` path constant (new) | Used by `writeHaltMarker` and `clearMarker` and by the sidecar-backed tracker |
| `writeHaltMarker` removes `HALT.episode` (changed) | Existing callers of the shared HALT writer (every step/runner HALT) |
| `clearMarker` removes `HALT.episode` (changed) | Existing callers: base-advance rekick sweep, episode recovery, operator rekick paths in `daemon-cli.ts` / `daemon-rekick.ts` |
| Sidecar-backed episode HALT tracker (changed `episode-halt-tracker.ts`) | Constructed where `createEpisodeHaltTracker()` is constructed today in `daemon-cli.ts`; written via the existing `onHaltWritten` dep from `engine/daemon.ts` collection |
| Stamped-HALT recovery at startup and idle ticks (changed trigger) | `DaemonMaintenance.startup` and `DaemonMaintenance.afterIdlePoll` in `engine/daemon.ts`, via the existing `sweepEpisodeHalts` dep |
| `RateLimitEpisode` deadline accessor (new) | Read at the `onHaltWritten` stamping point in `engine/daemon.ts` |

**Early overlap scan (advisory):** `ai-conductor overlap-scan` over these paths reported
`origin/spec/daemon-self-host-guardrails` (`daemon-rekick.ts`, `halt-marker.ts`) and
`origin/spec/self-host-phase6-wiring` (`daemon-cli.ts`). Both are long-lived historical spec branches;
no in-flight daemon build was reported touching these paths. Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A stale stamp auto-clears a later human-caused HALT | Data | Low | High | ADR decisions 2–3: lifecycle removal in the shared writer and `clearMarker`, plus digest match at recovery; invalid stamps discarded, HALT kept |
| Post-restart recovery re-kicks into a still-active provider limit | Technical | Medium | Low | Recover only after the recorded deadline; the conductor's rate-limit branch re-enters the episode and waits rather than halting (`adr-2026-07-05`) |
| A HALT writer bypasses `writeHaltMarker`, so a stale stamp is not removed | Data | Low | Medium | Digest check (decision 3) catches it regardless of writer |
| Source check is too broad and flags prose that is not a command | Technical | Medium | Low | Scope the check to guidance strings in `index.ts`; the builder's closed set is the allowed path |
| Overlap with concurrent daemon work in `daemon-cli.ts` | Integration | Low | Low | Advisory scan clean of in-flight builds; conflicts resolve at rebase |

## ADRs Created

- `adr-2026-10-10-durable-episode-halt-stamp` — durable `.pipeline/HALT.episode` sidecar with the
  HALT.class lifecycle and digest validity (state/data architecture: a durable state-transition
  design not covered by an existing ADR). Item 1 is not a structural decision (a module inside the
  existing CLI, no boundary change) and gets no ADR.

## Conditions

None.
