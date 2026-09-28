# Sequence: Provider admission — substitution policy and spine-durable exhaustion suppression

**Last updated:** 2026-09-23
**Scope:** How a step's provider candidate list is narrowed by substitution policy, how each
candidate passes a single admission gate before any subprocess is dispatched, how a usage-exhausted
provider is recorded on the event spine with its provider and deadline, and how that suppression is
rebuilt across the `beginFeatureRun` boundary that discards every runtime-object cache today.

## Diagram

```mermaid
sequenceDiagram
    participant Step as Step runner (conductor)
    participant Sel as resolveProviderCandidates
    participant Exec as executeProviderCandidates
    participant Gate as admitCandidate (NEW)
    participant Proj as ProviderAvailability projection (NEW)
    participant RT as ProviderRuntime
    participant Prov as Provider subprocess
    participant Spine as ConductorEventEmitter to events.jsonl

    Step->>Sel: configuredProviders + stepSelection + substitution policy
    alt substitution disallowed (global or per step)
        Sel-->>Step: candidates = stepSelection only («claude»)
    else substitution allowed («default»)
        Sel-->>Step: candidates = union of step and global, as today
    end

    Step->>Exec: execute over candidates

    loop for each candidate «provider»
        Exec->>Gate: may «provider» be invoked now?
        Gate->>Proj: availability of «provider» at now
        Proj-->>Gate: admitted OR suppressed until «deadline»

        alt suppressed — window not yet elapsed
            Gate-->>Exec: refuse, reason provider-suppressed, «remaining»
            Exec->>Spine: provider_attempt invoked false, skipReason provider-suppressed
            Note over Exec,Prov: No subprocess is spawned — this is the cost the change removes
        else admitted
            Exec->>RT: invokeRuntime
            RT->>Prov: spawn
            Prov-->>RT: InvokeResult

            alt result.rateLimited / usageExhausted
                RT-->>Exec: rateLimited with waitSeconds and optional deadline
                Exec->>Spine: rate_limit with provider and deadline (NEW fields)
                Note over Exec,Spine: hasRecoveryPrecedence still refuses to advance the<br/>candidate loop — the run waits, it does not substitute
                Exec->>Proj: suppress «provider» until «deadline»
                Exec-->>Step: rateLimited result
                Step->>Step: rateLimitEpisode.enter, then wait to «deadline»
            else ordinary result
                RT-->>Exec: result
                Exec->>Spine: provider_attempt invoked true
                Exec-->>Step: result
            end
        end
    end

    Note over Step,Spine: Dispatch boundary — beginFeatureRun rebuilds every runtime
    Step->>Proj: rebuild at beginFeatureRun
    Proj->>Spine: replay rate_limit records carrying provider and deadline
    Spine-->>Proj: suppression still in force for «provider» until «deadline»
    Note over Proj: runWideUnavailable and ModelAvailability are discarded here today —<br/>the projection survives because its source is the persisted ledger
```

## Amendment

> **Amended 2026-09-23 by #1492:** the diagram above shows the projection rebuilt at
> `beginFeatureRun` by replaying the feature's own `.pipeline/events.jsonl`. Architecture review
> falsified that: `startFeatureEventPersistence` writes `<worktree>/.pipeline/events.jsonl`
> (`event-persister.ts:306-308`), which no other feature can see, and
> `startDaemonEventPersistence` — the only daemon-wide ledger, `<mainRoot>/.daemon/events.jsonl`
> (`event-persister.ts:324`) — **drops every feature-forwarded event**
> (`if (isForwardedFromFeature(event)) return;`, `event-persister.ts:326-327`). A `rate_limit`
> emitted inside a feature's conductor is feature-forwarded, so it never reaches the daemon ledger
> and a replay-rebuilt projection would always come back empty.
>
> The corrected ownership is below: the availability store is **daemon-scoped and injected**,
> exactly as `RateLimitEpisode` already is — `createRateLimitEpisode()` is constructed once at
> `daemon-cli.ts:1113`, above every feature run, and injected into each Conductor
> (`daemon-cli.ts:1391`, `:1957`; held at `conductor.ts:2692`). Because it is constructed above
> `beginFeatureRun`, it survives the dispatch boundary without any replay. Durability across a
> daemon restart comes from daemon-origin emission of the suppression record, which is not
> feature-forwarded and therefore does persist to `.daemon/events.jsonl`.
>
> The original diagram is preserved above as the superseded mechanism.

### Corrected ownership

```mermaid
sequenceDiagram
    participant DCLI as daemon-cli (startup)
    participant Store as ProviderAvailability store (daemon-scoped)
    participant DLedger as .daemon/events.jsonl
    participant Run as beginFeatureRun
    participant Cond as Conductor (feature)
    participant Gate as admitCandidate

    DCLI->>Store: construct once, above every feature run
    Store->>DLedger: on restart, replay daemon-origin suppression records
    DLedger-->>Store: suppression for «provider» until «deadline»

    loop each feature dispatch
        DCLI->>Run: beginFeatureRun
        Run->>Cond: inject Store, as rateLimitEpisode is injected today
        Note over Run,Cond: runtimes and ModelAvailability are rebuilt here —<br/>the injected Store is not, because it was built above
        Cond->>Gate: admit «provider»?
        Gate->>Store: availability at now
        Store-->>Gate: admitted OR suppressed until «deadline»
        Cond->>Store: on rateLimited, suppress «provider» until «deadline»
        Cond->>DLedger: daemon-origin suppression record (not feature-forwarded)
    end
```

## Legend

- **`admitCandidate`** is the one new seam, evaluated per candidate immediately before dispatch.
  It governs only suppression and availability. Substitution policy is resolver-owned:
  `resolveProviderCandidates` removes a policy-forbidden candidate before execution, so that
  candidate never reaches the gate and records no `provider_attempt` (ADR D1 as amended 2026-09-25).
- **`provider_attempt { invoked: false }`** is reused, not invented. Its documented meaning is
  already "a cached unavailability avoided process dispatch"; the refusals extend `skipReason`
  alongside the existing `setup-unavailable` and `cached-unavailable` values.
- **The `rate_limit` event gains `provider` and `deadline`.** Today it carries `waitSeconds` and an
  optional `reason` only, so the persisted ledger cannot say which provider was exhausted or when it
  recovers — which is precisely why no cache can be rebuilt from it.
- **Suppression is self-expiring.** The bound is the deadline the adapter already parses (Claude
  emits `{ waitSeconds, deadline }`; Codex emits `waitSeconds` only), falling back to a bounded
  interval when no deadline was parsed. A transient limit therefore never permanently demotes a
  provider.
- **Exhaustion is still not a fallback trigger.** `hasRecoveryPrecedence` continues to short-circuit
  before any candidate advance, so the run's outcome is unchanged — it waits. The change removes the
  wasted subprocess that exists only to rediscover the same limit, once per step and again per
  feature dispatch.
- **The projection is spine-derived by design.** Per this repository's event-spine principle, the
  durable state extends the existing record rather than adding a sidecar file; that is also what
  makes it survive `beginFeatureRun`, where `runWideUnavailable` (a plain runtime field) and
  `ModelAvailability` (an explicitly in-process `Set`) are both thrown away.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-23 | Initial diagram for the admission gate, the policy narrowing, and spine-carried suppression. | Fix the seam, the new event fields, and the dispatch-boundary rebuild before implementation, and make explicit that exhaustion remains a wait rather than becoming a substitution (#1492). |
| 2026-09-25 | Policy refusal no longer routes through the gate; the gate governs suppression only. | As-built AB-1: resolution removes policy-forbidden candidates per ADR D2, so the gate's policy arm was unreachable; ADR D1 amended by operator decision. |
