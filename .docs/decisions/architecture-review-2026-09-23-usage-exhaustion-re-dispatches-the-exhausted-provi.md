# Architecture Review: Provider substitution policy and exhaustion suppression

**Date:** 2026-09-23
**Mode:** lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Source:** `jstoup111/ai-conductor#1492`
**Stories reviewed:** none yet — this is the pre-stories pass; the input is the explore output,
the track scope boundary, and the intake's desired outcomes.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. Every change lands in existing modules: `engine/provider-selection.ts`, `engine/provider-execution.ts`, `types/config.ts`, `types/events.ts`, `daemon-cli.ts`. |
| **Prerequisites** | None external. The injection point the design needs already exists: `createRateLimitEpisode()` at `daemon-cli.ts:1113`, injected at `:1391` and `:1957`. |
| **Integration surface** | Three boundaries — config load, provider execution, event spine. Below the 3+ flag only because all three are inside one subsystem. |
| **Data implications** | No schema, no migration, no backfill. Two optional fields on one event variant; optional so historical records retain their meaning (the precedent is adr-2026-08-11 D2). |
| **Performance risk** | The gate runs per candidate on a dispatch hot path. It must be an in-memory map lookup. **Condition 3** forbids a per-call ledger read. |
| **Worktree isolation** | Safe, and materially improved. The store is daemon-scoped, not worktree-scoped, so parallel worktrees share it by construction rather than contending for a file. No port, DB, queue, or path is introduced. |

**Falsified mechanism (design corrected before approval).** The intake's hypothesis — and the
first revision of this feature's architecture diagram — proposed rebuilding suppression state by
replaying the event spine at `beginFeatureRun`. That is not implementable as stated:

- `startFeatureEventPersistence` writes `<worktree>/.pipeline/events.jsonl`
  (`event-persister.ts:306-308`), which no sibling feature can read.
- `startDaemonEventPersistence` — the only daemon-wide ledger,
  `<mainRoot>/.daemon/events.jsonl` (`event-persister.ts:324`) — begins its handler with
  `if (isForwardedFromFeature(event)) return;` (`event-persister.ts:326-327`). A `rate_limit`
  emitted inside a feature's conductor **is** feature-forwarded, so it never lands there.

A replay-rebuilt projection would therefore always be empty. `.docs/architecture/` was amended
additively on 2026-09-23 with the corrected daemon-scoped-injection ownership; the superseded
mechanism is preserved in that file. The corrected shape is not novel — it is precisely how
`RateLimitEpisode` already survives the dispatch boundary.

**Calibration.** Code facts are verified by direct read (~97%). The operator's wall-clock
observation is unverified: no `rate_limit` record appears in the current ledgers. It is fully
explained by the verified per-step path, so the work is justified without it, but see Risk R4.

## Alignment

**Governing decisions applied.**

- **adr-2026-07-05-daemon-rate-limit-episode-coordinator (APPROVED)** governs the rate-limit
  episode. Its D2 already gates *new feature dispatch* on `episode.active()`
  (`engine/daemon.ts:925`, `:1066`, `:1360`, `:1675`). This **qualifies the intake's claim** that
  the exhausted provider is re-dispatched on every feature dispatch: while the episode survives,
  that path is already gated. The real remaining exposure is (a) per-step within an in-flight
  feature, and (b) after the episode is lost — D11 explicitly accepts that an operator restart
  loses it — or after its deadline expires while the provider's true window has not. The stories
  must be written against that narrower, accurate exposure, not the broader claim.
- The new ADR **does not supersede** adr-2026-07-05 and does not reopen its rejected Option A. The
  episode stays provider-blind, in-process, and unmodified; the availability store is a separate
  concern (admission, not waiting). Recorded as D8 of the new ADR.
- **adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal D4** requires every
  documented config key to carry a consumer declaration in the total registry. The new key(s) are
  bound by it. → **Condition 1**.
- **adr-2026-08-11-halt-events-ride-the-persisted-spine D2** is the precedent for adding an
  optional, centrally stamped field to an existing event rather than minting a new variant. The
  `rate_limit` additions follow it. Its "OTel is out of scope" section also warns that
  `OtelVisualizer` subscribes from its own hardcoded list and does not read `EVENT_SINKS` —
  relevant here because extending an event does not make it reach that consumer.
- **CLAUDE.md event-spine principle** — extend the spine, never add a parallel channel. Honored:
  no sidecar file, no new channel, and the refusal reuses `provider_attempt`.
- **CLAUDE.md machinery principle** — the gate is machinery at the point of the mistake rather
  than a prompt-level rule, and the config-key registry entry is a mechanical obligation rather
  than author discipline.

**Pattern consistency.** The design reuses three established shapes rather than inventing any:
daemon-scoped construction above `beginFeatureRun` with per-Conductor injection
(`RateLimitEpisode`); an optional-by-default absent dependency meaning today's behavior
("optimization-never-authority", adr-2026-07-05 D2); and a closed-set discriminator extended with
new members (`skipReason`). BUILD should preserve those traits — dependency injected not
imported, absent dependency degrading to current behavior, exhaustive handling of the closed set —
and resolve equivalents against its own HEAD rather than against the line numbers cited here.

**State management.** `skipReason` is a closed string union, not booleans, so a refusal cannot
represent two reasons at once. The substitution policy must likewise be a closed set rather than
an `is_*` flag if it is ever to grow a third mode. Suppression is `(provider → deadline)`, a
representation in which "suppressed but expired" is not a distinct state — it is simply
`now >= deadline`.

**Security boundaries.** No new endpoint, input, or credential surface. One caution: a suppression
reason derived from a provider's limit message must not copy that message verbatim into the
ledger, since those messages have carried account identifiers. → **Condition 4**.

**Production DI defaults.** No in-memory store is registered as a production default for stateful
data. The availability store is a cache of a transient, self-expiring fact whose loss degrades to
today's behavior — it is not a persistence substitute. Its one durable element is the spine record.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| Substitution-policy config key (global + per step) | Read at config load into `HarnessConfig` (`types/config.ts`); consumed by `resolveProviderCandidates` (`engine/provider-selection.ts`), the single existing resolver for every candidate list. Declared in the config-key consumer registry per adr-2026-08-26 D4. |
| `admitCandidate` seam | Called from the candidate loop in `executeProviderCandidates` (`engine/provider-execution.ts`), immediately before `invokeProviderCandidate`, on the path every step dispatch already takes. |
| `ProviderAvailability` store | Constructed once in `daemon-cli.ts` beside `createRateLimitEpisode()` (`:1113`); injected into each Conductor at the existing injection sites (`:1391`, `:1957`) and held as a private field as `rateLimitEpisode` is (`conductor.ts:2692`). Read by `admitCandidate`, written by the conductor's rate-limit branch (`conductor.ts:10239-10275`). |
| New `skipReason` members | Emitted on the existing `provider_attempt` record from the refusal path in `executeProviderCandidates`; consumed by every existing `provider_attempt` reader with no change. |
| `rate_limit` `provider` / `deadline` fields | Stamped at the single existing emit site (`conductor.ts:10253-10257`); persisted by `EventPersister` via the unchanged `EVENT_SINKS` routing. |

Design-time commitment only; §12's as-built sweep verifies shipped callers independently.

**Early overlap scan.** `ai-conductor overlap-scan` over the paths above: *no overlap detected, no
open blockers*. Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 — Refusing every candidate collapses into "candidates exhausted" and converts today's wait into a HALT | Technical | Medium | High | ADR D7 binds the behavior; Condition 2 requires a test that all-suppressed yields a wait, never a failure |
| R2 — New config key silently omitted from the config-key consumer registry | Integration | Medium | Medium | Condition 1; adr-2026-08-26 D4 makes the registry total, so the omission is mechanically catchable |
| R3 — Gate reads the ledger per candidate and slows every dispatch | Performance | Low | Medium | Condition 3 — in-memory lookup only; the injected store is already resident |
| R4 — Suppression bound to a mis-parsed or absent deadline sidelines a healthy provider | Technical | Medium | Medium | ADR D6 bounds the default interval and forbids permanent demotion; Codex emits `waitSeconds` only, so the default path is the common one for it |
| R5 — Provider limit message copied verbatim into the ledger leaks account identifiers | Security | Low | Medium | Condition 4 — sanitized reason, never the raw message |
| R6 — Interactive and daemon runs diverge in suppression behavior | Knowledge | High | Low | Accepted and recorded in the ADR's Negative consequences; document it where the config key is documented |

R1 is Impact=High, so the review marker is written.

## ADRs Created

- `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability.md` — 8 decisions.
  Structural prerequisite met under **state/data architecture**: it establishes the ownership and
  lifetime of durable provider-availability state and its boundary against an existing coordinator.
  Reuse check performed first: adr-2026-07-05 governs the episode but not per-candidate admission,
  and is cited and preserved rather than duplicated or superseded.
  **Awaiting operator approval — not authoritative until approved.**

## Conditions

1. **Declare every new config key in the config-key consumer registry** required by
   adr-2026-08-26 D4, in the same change that introduces the key.
2. **All-candidates-suppressed must yield a wait, not a failure.** ADR D7. Requires explicit test
   coverage; this is the one way the change could turn a pause into a HALT.
3. **The admission gate performs no I/O.** In-memory lookup against the injected store only — no
   ledger read, no file stat, per candidate.
4. **Suppression reasons are sanitized.** Never persist a provider limit message verbatim.
5. **Confirm the release-metadata disposition** for an additive optional config key before the
   implementation PR opens. A migration block is required only for a real schema behavior change
   (adr-2026-07-06-migration-gate-waiver); an additive optional key is not one, but the gate's
   path-based classifier may still flag the surface.
6. **Write the stories against the corrected exposure**, not the intake's broader claim: the
   per-feature-dispatch path is already gated by adr-2026-07-05 D2 while the episode survives.

Conditions are tracked into the plan and checked at code review; unmet conditions at `/finish`
are blocking.
