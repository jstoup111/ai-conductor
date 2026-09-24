# ADR: Provider admission is one gate over a daemon-scoped availability store

**Date:** 2026-09-23
**Status:** APPROVED
**Deciders:** Operator (jstoup111), architecture-review for #1492

<!-- Filename convention: adr-2026-09-23-<kebab-slug>.md (no sequential numbers).
     The ADR's identifier is its filename stem — cite that when superseding or referencing. -->

## Context

Source: `jstoup111/ai-conductor#1492`. Two operator asks: provider substitution must be
disallowable (globally and per step), and a provider already observed usage-exhausted must stop
being re-dispatched for the rest of its window.

Verified facts, all read directly in this worktree at the reviewed HEAD:

- `hasRecoveryPrecedence` (`engine/provider-execution.ts:322-328`) returns true for
  `authFailure`, `rateLimited`, or `sessionExpired`, and `classifyProviderCandidateFailure`
  short-circuits on it. Usage exhaustion therefore **never** advances the candidate loop — the run
  waits (`engine/conductor.ts:10239-10275`). Provider fallback is reachable only for run-scoped
  unavailability and for `modelUnavailable` after the native model ladder is exhausted.
- `resolveProviderCandidates` (`engine/provider-selection.ts:10-20`) returns
  `stableUniqueProviders([...stepSelection, ...configuredProviders])`. A per-step pin is a
  **preference**, not a restriction: with `llm_provider: [codex, claude]`, a step pinned to
  `claude` still resolves to `[claude, codex]`. `rebase` and conflict resolution are pinned by
  explicit operator order (`.ai-conductor/config.yml:111-117`), and that pin does not bind.
- `runWideUnavailable` is a plain field on the runtime object (`engine/provider-runtime.ts:28`),
  set only at `provider-execution.ts:470` — downstream of the `hasRecoveryPrecedence` guard, so
  the exhaustion class never reaches it. Its model-level twin is an explicitly in-process `Set`
  (`engine/model-availability.ts:31-38`).
- `beginFeatureRun` rebuilds the runtime set per feature (`daemon-cli.ts:919` →
  `createProviderRuntimeSet`), so every candidate-layer cache is discarded at each dispatch.
- The `rate_limit` event carries `waitSeconds` and an optional `reason` only
  (`types/events.ts:834`). It names no provider and no deadline, so the persisted ledger cannot
  say which provider was exhausted or when it recovers.
- `provider_attempt` already carries `invoked: boolean`, documented as "False when a cached
  run-wide unavailability avoided process dispatch", and a `skipReason` closed set of
  `'setup-unavailable' | 'cached-unavailable'` (`types/events.ts:255-267`).

Two facts found during review that falsify the intake's suggested mechanism:

- **A feature's spine is not readable across features.** `startFeatureEventPersistence` writes
  `<worktree>/.pipeline/events.jsonl` (`event-persister.ts:306-308`).
- **The daemon-wide ledger excludes feature events by construction.**
  `startDaemonEventPersistence` writes `<mainRoot>/.daemon/events.jsonl` and opens its handler
  with `if (isForwardedFromFeature(event)) return;` (`event-persister.ts:324-327`). A
  `rate_limit` emitted inside a feature's conductor is feature-forwarded, so it never lands
  there. A projection rebuilt by replaying that ledger would always be empty.

The governing prior decision is
[adr-2026-07-05-daemon-rate-limit-episode-coordinator](adr-2026-07-05-daemon-rate-limit-episode-coordinator.md)
(APPROVED). Its Option B chose an in-process coordinator and explicitly **rejected** the
file-marker Option A, accepting "in-process only (no cross-process/restart persistence) …
because we run one daemon per repo and an episode is transient". Its D2 gates **new feature
dispatch** on `episode.active()` (`engine/daemon.ts:925`, `:1066`, `:1360`, `:1675`). That
materially qualifies the intake's claim that the exhausted provider is re-dispatched "on every
feature dispatch": while the episode survives, new dispatch is already gated. The gap re-opens
when the episode is lost — D11 accepts that an **operator** restart loses it — or when the
episode's deadline expires while the provider's real window has not (the 300s default applies
whenever no deadline parses, and Codex emits `waitSeconds` only,
`execution/codex-provider.ts:438`, against Claude's `{ waitSeconds, deadline }`,
`execution/claude-provider.ts:692-697`).

Confidence: the code facts above are **verified** (direct read, ~97%). The operator's observation
that exhaustion costs repeated real dispatches is **unverified** telemetry — no `rate_limit`
record appears in the current ledgers — but it is fully explained by the per-step path, which is
verified.

## Options Considered

### Option A: Enforce policy in `resolveProviderCandidates`, make `RateLimitEpisode` provider-keyed
- **Pros:** reuses an existing "unavailable until `untilMs`" model with later-deadline-wins and
  escalation; the daemon already gates dispatch on it.
- **Cons:** the episode's job is a **run-wide coordinated pause** — adr-2026-07-05 D2/D10 build on
  it being account-level and provider-blind, and its escalation counter is deliberately shared
  across features. Making it provider-keyed gives one object two meanings and forces the daemon's
  dispatch gate to ask *which* provider it is blocked on. Policy then lives in a second seam with
  its own telemetry story.
- **Rejected.**

### Option B: One admission gate over a daemon-scoped availability store (CHOSEN)
- **Pros:** policy refusal and exhaustion refusal are the same question — "may this candidate be
  invoked right now?" — so they share one seam, one record, and one place to read. Reuses
  `provider_attempt { invoked: false }`, whose documented meaning already is exactly this. The
  store is constructed above `beginFeatureRun` and injected, which is the *existing* proven
  pattern for `RateLimitEpisode` (`daemon-cli.ts:1113` → `:1391`, `:1957`), so it survives the
  dispatch boundary with no replay and no new sidecar file.
- **Cons:** one more injected daemon-scoped object; in interactive runs (`index.ts`, no daemon)
  it is run-scoped, so cross-run suppression applies to daemon operation only.

### Option C: Persist suppression to a sidecar file under `.pipeline/` or `.daemon/`
- **Pros:** survives any restart, including a full daemon replacement.
- **Cons:** this repository has one telemetry spine and a standing rule against a parallel
  channel; a sidecar is invisible to every existing consumer. adr-2026-07-05 already rejected the
  file-marker shape for this exact concern.
- **Rejected.**

## Decision

1. **A single admission gate owns every "may this candidate run now" refusal.** One seam,
   evaluated per candidate in `executeProviderCandidates` immediately before dispatch, is the only
   place that answers the question. Both substitution-policy refusal and exhaustion suppression
   exit through it; neither gets a bypass path. This is chosen over two separate seams because the
   two refusals are the same question asked for two reasons, and splitting them is what produces
   divergent telemetry.

2. **Substitution policy narrows the candidate list rather than reordering it.** A new
   configuration, settable globally and per step, makes `resolveProviderCandidates` return the
   step's own selection instead of its union with the global list. With the policy unset, the
   union is returned exactly as today, so an unconfigured repository is byte-for-byte unchanged.
   The new key is additive and optional, and is declared in the config-key consumer registry
   required by adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal D4.

3. **Refusals are recorded on the existing `provider_attempt` record, not a new event.** The
   refusal emits `provider_attempt` with `invoked: false` and extends the `skipReason` closed set
   with the two new refusal reasons. `invoked` already means "a cached unavailability avoided
   process dispatch"; a new event type would give the same fact two spellings and leave existing
   readers blind to half of it.

4. **Provider availability is daemon-scoped state, injected, never rebuilt per feature.** The
   store is constructed once alongside `createRateLimitEpisode()` in `daemon-cli.ts` — above
   `beginFeatureRun` — and injected into each Conductor exactly as `rateLimitEpisode` is. It is
   deliberately **not** rebuilt by replaying a feature ledger: `startDaemonEventPersistence` drops
   feature-forwarded events (`event-persister.ts:326-327`), so such a replay is guaranteed empty.
   When no store is injected (interactive runs), behavior is today's.

5. **`rate_limit` gains an optional `provider` and an optional `deadline`.** Both are optional so
   historical records keep their current interpretation, following
   adr-2026-08-11-halt-events-ride-the-persisted-spine D2's precedent of an optional, centrally
   stamped field. Without these the ledger cannot name what was exhausted or when it recovers, and
   no observer — operator or machine — can see the suppression window.

6. **Suppression is self-expiring, bounded, and never a demotion.** The bound is the parsed
   deadline when one exists, and a bounded default interval when none does. On expiry the provider
   is attempted again with no operator action. Suppression changes only whether a subprocess is
   spawned; it never reorders candidates and never marks a provider permanently unavailable.

   > **Amended 2026-09-23 by #1492 DECIDE (coherence-check):** suppression is **unconditional** —
   > it has no configuration key of its own and cannot be turned off. The intake's desired outcome
   > "With neither setting configured, behavior is unchanged from today" presumes two settings;
   > this design ships one, the substitution policy of decision 2. The operator confirmed that
   > outcome binds the substitution setting only. The reasoning is decision 7: exhaustion remains a
   > wait, so an unconfigured repository sees the same run outcomes it sees today — what changes is
   > the number of subprocesses spawned to rediscover a known limit, and the two optional fields of
   > decision 5. A suppression opt-in was considered and rejected here because defaulting it off
   > would leave the wasted dispatch the issue was filed about in place for every repository that
   > never finds the key. The original decision text above is unchanged.

7. **Exhaustion remains a wait, not a substitution — `hasRecoveryPrecedence` is unchanged.** When
   the gate refuses every candidate because all are suppressed, the step yields the rate-limited
   result and the conductor enters its existing wait. It must not yield a failure: a refusal that
   collapsed into "candidates exhausted" would convert today's wait into a HALT. This preserves
   adr-2026-07-05's account-level pause semantics and keeps `claude`-pinned rebase work off Codex.

8. **`RateLimitEpisode` is not superseded and not modified.** It remains the run-wide coordinated
   pause of adr-2026-07-05, provider-blind and in-process by that ADR's accepted trade-off. The
   availability store is a *separate* concern — per-candidate admission, not waiting — and adding
   it does not reopen Option A of that ADR. The daemon dispatch gate of its D2 keeps working
   unchanged.

## Consequences

### Positive
- A provider observed exhausted costs at most one real dispatch per window per daemon, instead of
  one per step and one per feature dispatch.
- A step pinned to one provider is honored, and the honoring is checkable: its `provider_attempt`
  records show no attempt against any other provider.
- The suppression, its reason, and its remaining time are visible in telemetry an operator already
  reads, through a record that already exists.
- No new file, no new channel, no new event type.

### Negative
- One more injected daemon-scoped object, and one more thing a test double must supply.
- Interactive runs get no cross-run suppression, so the two execution modes differ. Accepted: the
  daemon is where the repeated cost was observed.
- Suppression state is lost when the daemon process is replaced, unless the suppression record is
  emitted daemon-origin. That emission is the only durability mechanism here, and it is narrow.
- A wrong or over-long deadline suppresses a healthy provider for that window. D6's bounded
  default limits the blast radius but does not remove it.

### Follow-up Actions
- [ ] Declare the new config key(s) in the config-key consumer registry (adr-2026-08-26 D4).
- [ ] Confirm the release-metadata disposition for an additive optional config key; a migration
      block is required only for a real schema behavior change
      (adr-2026-07-06-migration-gate-waiver).
- [ ] Decide during `/plan` whether the suppression record is a daemon-origin emission or a
      daemon-owned stamp on the existing `rate_limit`, since only a non-feature-forwarded event
      reaches `.daemon/events.jsonl`.
