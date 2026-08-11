# Observability Assessment

**Date:** 2026-08-10
**Reviewer:** Observability Reviewer Agent
**Verdict:** CRITICAL

**Scope adaptation:** This target is not a web service. Its "production incident" is: an
autonomous overnight build silently stalls, spins, or halts, and the operator must reconstruct
WHY the next morning from `.pipeline/events.jsonl`, `.pipeline/audit-trail/events.jsonl`,
`.daemon/daemon.log`, and provider transcripts alone — no live human, no dashboard, no on-call.
The checklist below is read through that lens, not an HTTP-service SLO lens. Every finding
carries a confidence % and basis (`verified` = read and traced; `inferred` = derived from
adjacent evidence, not directly observed). Low-confidence items are marked **tentative**.

---

## Category 1: Error Handling (read as: silent failure)
**Status:** CRITICAL

| Severity | Finding | Location |
|----------|---------|----------|
| critical | **The single most important diagnostic event — the terminal HALT — does not reach the event spine.** `loop_halt` (`reason: string` — "the gate loop stopped without converging") is declared `{ render: true, persist: false, audit: true }` in the sink registry. `EventPersister.start()` subscribes only to `persistedEventTypes()` (filtered by `.persist`), so `loop_halt` is **never written to `.pipeline/events.jsonl`**, the artifact CLAUDE.md and the event-spine skill both name as the one spine. It is only (a) rendered to a terminal the daemon-log.ts header itself says "you may not be attached to," and (b) written to a *different file with a different schema* — see next finding. An operator opening `.pipeline/events.jsonl` the morning after a halt, exactly as the documented spine instructs, finds no `loop_halt` line at all. (95%, verified: `event-sinks.ts:58`, `event-persister.ts:60-63`) | `src/conductor/src/engine/event-sinks.ts:58` |
| critical | **The audit sink is itself a second, differently-shaped channel — the exact violation the event-spine skill's §3 test names.** `AuditTrailWriter` writes `.pipeline/audit-trail/events.jsonl` in a **bespoke `AuditRecord` shape** (`{step, phase, event, reason?, cause?, ...}`), not the `ConductorEvent` union, via its own `toRecordInput` translator (`audit-trail.ts:118-170`). It is a second format, second field names (`event`/`cause` instead of `type`/`reason`), and a second reader path — precisely "a bespoke sidecar with its own format... **A parallel channel. Violation.**" per `.agents/skills/event-spine/SKILL.md:75`. Worse, the translation is lossy and mislabeling: `toRecordInput` for `loop_halt` hardcodes `step: 'build'` (`audit-trail.ts:146`) regardless of which step actually halted, so an operator reading the one place `loop_halt` *is* durably recorded gets a wrong step attribution for any halt outside BUILD. (92%, verified) | `src/conductor/src/engine/audit-trail.ts:42-63,118-170` |
| critical | **A whole class of halt is invisible everywhere except a plain-text file.** `rebase_conflict_halt` — "a non-trivial/mixed conflict parked the feature" — is declared `{ render: false, persist: false, audit: false }`. It appears in NONE of the three sinks. The only durable trace of a rebase-conflict park is the free-text body of `.pipeline/HALT`, written by a **best-effort, swallow-on-failure** function (`writeHaltMarker`, next finding) with no structured reason code. An operator cannot `grep rebase_conflict_halt .pipeline/events.jsonl` — there is nothing to find. (90%, verified: `event-sinks.ts:66`) | `src/conductor/src/engine/event-sinks.ts:66` |
| critical | **`writeHaltMarker` is best-effort and silently drops the HALT write on I/O failure**, per CLAUDE.md's own architecture-review finding (D-item in cto-architecture.md §6.4): `unlink(haltClassPath)` returns early on any non-`ENOENT` error (`halt-marker.ts:56-58`), and the `writeFile`/`rename` sequence catches all errors and only best-effort-unlinks the temp file — no error surfaced, no event emitted, no retry. A permissions or disk error at the exact moment a build should park means **the daemon advances past a condition that should have stopped it**, and nothing in any log records that the HALT write was attempted and failed. Confirms and specializes the architecture reviewer's D-item from an observability angle: this is not just a durability gap, it removes the primary alerting signal (§ Alerting below) with no compensating telemetry. (90%, verified) | `src/conductor/src/engine/halt-marker.ts:45-67` |
| important | **A concrete, currently-dead consumer proves the `persist:false` gap is not theoretical.** `computeCostRollup` explicitly counts halts from the spine (`if (e.type === 'loop_halt') rollup.halts += 1;`, `cost-rollup.ts:174-177`) — but because `loop_halt` is never persisted to `events.jsonl` (see above), **this code path is unreachable in production and `rollup.halts` is always 0.** Any per-feature cost/halt report built on `computeCostRollup` silently under-reports halt count to zero, with no error, no warning — the exact "silent failure that reports success" pattern this checklist exists to catch. (90%, verified: traced `EVENT_SINKS.loop_halt` → `persistedEventTypes()` → `EventPersister.start()` → `cost-rollup.ts:174`) | `src/conductor/src/engine/cost-rollup.ts:174-177` |
| important | **Data-integrity's finding has a direct observability consequence, not just a durability one.** `appendFileSync` with no `fsync` (`event-persister.ts:125`, `audit-trail.ts:78`) plus every reader `catch{}`-dropping unparseable lines with **no diagnostic and no count** (per cto-data-integrity.md) means: on the exact failure mode CLAUDE.md documents as routine (a crash, a killed daemon, a live-boundary abort — all mid-write), the last line of the operator's primary diagnostic artifact can be torn, and the reader gives no signal that anything was lost. An operator sees a shorter-than-expected `events.jsonl` and cannot tell "the run was short" from "the log was truncated." (88%, verified code path; inferred that this is the dominant loss mode for the specific incident this repo cares about — crash-during-halt) | `src/conductor/src/engine/event-persister.ts:125`; `src/conductor/src/engine/cost-rollup.ts:108-124` (silent skip, folded into `unmetered.count` with no distinguishing flag) |
| important | **35 `.catch(() => {})` / bare-empty-catch sites** across `src/conductor/src` swallow errors with zero emission (event, log line, or stderr write) at the point of failure — counted by grep, not individually traced for severity. A sample already covered above (`halt-marker.ts`) shows the pattern is not cosmetic. The remainder were not individually audited for this report; treat the count as a lower bound on where a run can silently drop something a diagnosing operator would want to know about. **tentative** (60%, inferred from grep count; not all 35 traced for actual diagnostic impact) | grep `catch (.*) {}\|\.catch(() => {})` across `src/conductor/src`, 35 hits |
| minor | `AuditTrailWriter.record` does have a genuine, well-built failure signal for its own write path — `WRITE-FAILED` marker plus stderr — the correct pattern (contrast with `halt-marker.ts` above, which has none). Noted as a positive counter-example, not a finding against it. (95%, verified) | `src/conductor/src/engine/audit-trail.ts:79-98` |

---

## Category 2: Logging
**Status:** NEEDS_WORK

| Severity | Finding | Location |
|----------|---------|----------|
| important | **`.daemon/daemon.log` is unstructured free-text, not structured/JSON, and carries no explicit severity level.** `formatDaemonLogLine` prepends only an ISO-8601 timestamp to an already-composed prose string (`daemon-log.ts:144-146`); there is no `level` field, no JSON shape, and the only signal distinguishing a lifecycle transition from ordinary activity is three literal glyphs (`▶`/`↻`/`■`) matched by regex in `writeDaemonMessage` (`daemon-log.ts:85-110`). An operator or a tool cannot mechanically filter "warnings and above" — everything is one undifferentiated stream, and machine parsing requires reverse-engineering the glyph convention rather than reading a `level` key. (92%, verified) | `src/conductor/src/engine/daemon-log.ts:40-146` |
| important | **Single-generation rotation caps retained history at ~2MB total.** `openDaemonLog` rotates once at 1MB to `daemon.log.1`, overwriting any prior rotation (`daemon-log.ts:21-22,169-178`) — there is no `daemon.log.2`, no timestamped archive, no external log-shipping. On a long-running daemon babysitting many overnight features, the activity record for a stall from several days ago can already be gone by the time an operator investigates, with no warning that it rotated out. (90%, verified) | `src/conductor/src/engine/daemon-log.ts:19-22,169-178` |
| minor | Feature-owned log lines ARE tagged with a bounded feature slug (`formatDaemonFeatureTag`, `daemon-log.ts:26-32`), which does give per-feature `grep`-ability inside the shared daemon.log — a genuine, working correlation primitive at the daemon-log layer (see Correlation section). Positive, not a defect. (90%, verified) | `src/conductor/src/engine/daemon-log.ts:26-32,121-131` |
| minor | Lifecycle-transition suppression (`lastStatus` map dedupes repeated start/resume/done lines, `daemon-log.ts:87-110`) is a reasonable noise-reduction feature, but it means a REPEATED start/done pair for the same feature+status is invisible in the log — if that repetition is itself the anomaly (e.g., a feature restarting in a loop), the log actively hides the pattern that would diagnose it. **tentative** (55%, inferred — I did not find a case where this specific suppression caused a real diagnostic miss, only that the mechanism could) | `src/conductor/src/engine/daemon-log.ts:76-91` |

---

## Category 3: Monitoring (read as: does the spine let you reconstruct WHY a build stalled)
**Status:** CRITICAL

**Traced failure, end-to-end: dispatch → step → gate → halt.**

1. Dispatch and step execution are well covered: `step_started`/`step_completed`/`step_failed`/
   `provider_attempt`/`step_retry` all persist (`event-sinks.ts:10-17`), carry `tokenUsage`,
   `observedIntervals` (start/duration), and provider identity. Reconstructing "what ran, how
   long, which provider, what it cost" from `events.jsonl` alone works well. (90%, verified)
2. Gate evaluation is also covered: `gate_verdict` (audit-only, not persisted — `render:true,
   persist:false, audit:true`) and `kickback` (all three sinks) give the gate's satisfied/reason
   and the kickback's `from`/`to`/`evidence`/`count`. (85%, verified)
3. **The halt itself is where the chain breaks.** As detailed in Category 1: `loop_halt` never
   reaches `events.jsonl`; its only durable, machine-readable record is a differently-shaped file
   (`audit-trail/events.jsonl`) with a hardcoded, sometimes-wrong `step` attribution; and
   `rebase_conflict_halt` — a documented, named halt condition — reaches **no** sink at all. The
   one artifact the spine's own consumer (the OTel exporter, the daemon, the audit trail) is
   supposed to make redundant-safe is exactly the one an operator needs most, and it is the
   least-covered event in the entire union.
4. **Practical consequence:** to answer "why did this build halt" from artifacts alone, an
   operator must know to check THREE different files in TWO different schemas
   (`.pipeline/HALT` free text, `.pipeline/audit-trail/events.jsonl` in `AuditRecord` shape,
   `.pipeline/events.jsonl` for everything leading up to the halt but not the halt itself) — this
   is the opposite of "one spine, one reader path" that CLAUDE.md and the event-spine skill
   mandate, discovered specifically for the halt case, which is the highest-stakes one.
   (90%, verified across all three files)

| Severity | Finding | Location |
|----------|---------|----------|
| critical | See end-to-end trace above: the halt event does not survive to the documented spine. | `event-sinks.ts:58,66`; `audit-trail.ts:145-146` |
| important | **No health-check / liveness surface for the daemon beyond the pidfile+lock.** There is no equivalent of an HTTP `/health`; the closest analogue is `daemon-lock.ts`'s pid-liveness check, which `cto-data-integrity.md` already flags as trusting pid-alone (recycled-pid risk). From an observability standpoint this means "is the daemon actually making progress" is answerable only by tailing `daemon.log` for new lines and inferring liveness from output cadence — there is no positive, structured "I am alive and here is what I'm doing" heartbeat surfaced anywhere outside prose log lines. **tentative** (65%, inferred — I did not exhaustively search for a dedicated liveness/heartbeat event; `build_progress`/`build_no_progress` exist but are per-feature-build, not daemon-wide) | n/a (absence) |
| important | **Progress lines carry limited diagnostic payload beyond reassurance.** `build_progress` (`resolved`/`total`/`currentTaskId`/`noEvidenceAttempts`/`tickReason`) is a genuinely useful, well-designed event (persisted, rendered) — this is a real positive. But the rendered daemon-log line an operator actually sees during a live session is prose composed from it, not the structured event; the structured form only helps if the operator (or a tool) reads `events.jsonl` directly rather than the log. So the *log* line ("▶ build 13/15") is reassurance-only ("still moving"), while the *event* underneath it is genuinely diagnostic — the two audiences (glance-at-terminal vs. post-hoc-diagnose) are served asymmetrically well. (75%, inferred from the event schema vs. the daemon-log rendering path; I did not trace the exact terminal-render call site for the literal string format) | `src/conductor/src/types/events.ts:328-349` (event); daemon-log rendering not fully traced |
| minor | `build_no_progress` (quiet-episode warning) and `build_stall` (terminal no-progress halt) both persist and render — this is a real, working early-warning mechanism for the "spins silently" failure mode named in the assignment, distinct from and better-covered than the "halts" failure mode. Positive. (85%, verified) | `src/conductor/src/types/events.ts:321-367`; `event-sinks.ts:43-45` |

---

## Category 4: Debugging Context
**Status:** NEEDS_WORK

| Severity | Finding | Location |
|----------|---------|----------|
| important | **No run/build/feature correlation id threaded through the event schema.** `ConductorEvent` (688 lines, `types/events.ts`) has no `runId`/`featureSlug`/`sessionId` field on the base type — only a handful of individual variants (`build_progress`, `build_no_progress`, `auto_park`, `attribution_divergence`) carry `featureSlug` optionally, and no variant carries a run-scoped id at all. ADR-014 says this explicitly and I confirmed it in code: *"Bus events carry no run id, so the exporter owns correlation"* (`adr-014-otel-observability-exporter.md:69`) — the OTel `SpanManager`/`resource.ts` invents `conductor.run.id` (from `.pipeline/conduct-session-id`, generated if absent) purely for its own span tree. This id is **never written back into `events.jsonl` or `audit-trail/events.jsonl`**, so it cannot be used to join an OTel trace to the plain event log even when OTel is enabled. (92%, verified: `otel/resource.ts:19-61`, absence confirmed by full read of `events.ts`) | `src/conductor/src/engine/otel/resource.ts:19-61`; `src/conductor/src/types/events.ts` (whole file — absence) |
| important | **Feature identity is carried by file path, not by field — which breaks under the repo's own documented recovery procedure.** `events.jsonl` lives at `<worktree>/.pipeline/events.jsonl` (`startFeatureEventPersistence`, `event-persister.ts:189-197`); within one worktree this is a working (if implicit) correlator. But CLAUDE.md's own "Daemon Operations Safety" rule #3 documents that `.worktrees/<slug>` removal is a real, already-occurred failure mode, and removing it **deletes the events.jsonl that would have identified which feature the events belonged to**, along with the events themselves — there is no daemon-wide event index that survives worktree deletion. Combined with the daemon-log's per-feature tag (`[slug]`) which DOES survive in `.daemon/daemon.log` (a repo-level file), the two halves of "what happened, to which feature" can permanently diverge: the daemon log remembers the feature slug, the events that explain what happened to it are gone. (80%, inferred — I traced both write paths and the CLAUDE.md-documented failure mode, but did not reproduce a worktree deletion) | `src/conductor/src/engine/event-persister.ts:189-197`; CLAUDE.md "Daemon Operations Safety" #3 |
| important | **Provider transcripts are not joinable to events.jsonl by any shared id.** `provider_attempt` events carry `step`, `provider`, `model`, `tokenUsage`, and a synthetic `attemptId` used only internally for interval bookkeeping (`ProviderLifecycleEventMetadata.attemptId`, `events.ts:116`) — I did not find this `attemptId` (or any other field) echoed into whatever session/transcript file the provider adapter itself writes (out of scope to fully trace provider-side transcript storage, but no such joining field appears anywhere in the event schema). An operator correlating "the events say step X failed" with "here is the Claude/Codex transcript for that attempt" has no id to search by other than approximate timestamp + step name. **tentative** (60%, inferred — did not trace the provider transcript storage format itself, only confirmed the event side has no exported joining id) | `src/conductor/src/types/events.ts:114-138` |
| minor | Where events DO carry structure (step, reason, attempt, retry counts, `observedIntervals` with start/duration), the structure is genuinely actionable — this is not a blanket criticism of event content, only of the missing cross-cutting id. Positive. (85%, verified) | `src/conductor/src/types/events.ts` (throughout) |

---

## Cross-cutting: the OTel exporter (9 `@opentelemetry/*` deps)

**Verdict: real, well-engineered, optional, off by default — but structurally cannot fix the
spine gaps above, and duplicates rather than resolves the correlation problem.**

- **Off by default, fails safe when misconfigured.** `resolveOtelConfig` never throws; an absent
  `otel:` config block returns `{enabled: false}` with no error, and an invalid one returns
  `{enabled: false, error}` rather than crashing the run (`otel-config.ts:33-67`). Verified this
  is actually load-bearing: `index.ts:1284-1296` only constructs/starts the visualizer when
  `otelResolved.enabled`. **The cost of it being wrong (bad endpoint, unreachable collector) is
  a bounded warning, not a broken build** — per ADR-014's stated design ("Failure isolation... a
  dead collector or unwritable file never fails or wedges a run") and confirmed by
  `stopVisualizers` swallowing individual stop() errors (`index.ts:193-201`) and `renderer_error`
  event emission on visualizer failure (`index.ts:274`). (90%, verified)
- **Off the hot path**, as designed: `SpanManager` methods are synchronous, non-blocking, and
  only enqueue to OTel's own `BatchSpanProcessor` (`span-manager.ts:13-15`). No await inside the
  event handler that would stall `ConductorEventEmitter.emit()`. (85%, verified by reading
  `span-manager.ts` header comment and method shapes; did not trace the OTLP export call itself)
- **It is genuinely wired, not aspirational scaffolding** — this is the correct conclusion
  against the assignment's framing. It registers through the reserved `visualizer` plugin kind,
  subscribes to the real bus, and produces real spans/metrics keyed by a real (if
  exporter-local) `conductor.run.id`. Contrast with architecture-review's D1 finding (a
  different, wholly-unimplemented ADR) — OTel is not in that category. (88%, verified)
- **What it does NOT fix:** because OTel is a bus *listener* like `EventPersister`, it inherits
  exactly the same gap the spine has — it subscribes to whichever events the union emits, and
  `loop_halt`/`rebase_conflict_halt` are emitted on the bus (persist/audit flags don't gate
  listeners, only the two file sinks), so **OTel likely IS the one consumer that sees a halt
  live**, if and only if it is enabled and a collector is actually running to receive it. For the
  documented incident shape (default config, overnight, unattended, reconstructing from
  artifacts the next morning) OTel is off by default and nothing writes its own durable local
  record unless `exporter: file` is explicitly configured — so for the common case, OTel does not
  help. **tentative** (65%, inferred — I did not verify whether `SpanManager` actually has a
  handler registered for `loop_halt`/`rebase_conflict_halt` specifically; the sink registry
  governs `render`/`persist`/`audit`, not bus subscription, so this is plausible but unconfirmed)

---

## Correlation — summary judgment

**No.** There is no id threaded through events.jsonl, daemon.log, audit-trail/events.jsonl, and
provider transcripts uniformly:
- `events.jsonl` ↔ feature: correlated only by directory location, lost if the worktree is
  deleted (a documented, already-occurred failure mode).
- `daemon.log` ↔ feature: correlated by a rendered `[slug]` tag — works, but is a different
  correlator than the one (or absent one) on the events themselves.
- `events.jsonl` ↔ `audit-trail/events.jsonl`: no shared id at all; joining requires matching on
  `step`+approximate `at`/`ts` timestamp, and the audit side's `loop_halt` `step` is sometimes
  wrong (hardcoded to `'build'`).
- `events.jsonl` ↔ OTel traces: `conductor.run.id` exists only inside OTel's own resource
  attributes; it is never written back to the plain event log, so joining requires OTel to be
  enabled with a queryable backend, not the default artifacts-only path.
- `events.jsonl` ↔ provider transcripts: no shared id found on the event side.

---

## Cost/token telemetry — summary judgment

**Mostly good, with one confirmed dead code path.** Per-dispatch `tokenUsage` (input/output/
cache) and `costUsd` are carried on `provider_attempt` and `step_completed` events and rolled up
per-feature (and per-provider) by `computeCostRollup` (`cost-rollup.ts`), which correctly
degrades unreadable/corrupt records into a visible `unmetered.count` bucket rather than silently
dropping them from the total (85%, verified — this is a genuinely well-designed reader,
contrasting with the raw `catch{}`-drop pattern flagged elsewhere in the review). `feature_usage_total`
gives a one-line whole-feature summary emitted at `finish`. **However**, halt-count within that
same rollup (`rollup.halts`) is dead — see Category 1 — because its source event never reaches
the file it reads. There is no live "$ spent so far, this step" surfaced during a running build;
cost is a post-hoc read of `events.jsonl`, which is adequate for the documented "diagnose the
next morning" use case but does not support noticing an expensive run mid-flight without manually
running the rollup. (80%, verified for the rollup mechanism; inferred for the "no live indicator"
absence claim — did not exhaustively search the daemon dashboard renderer)

---

## Alerting — summary judgment

**Partial, and the strongest mechanism (`HALT`) has no telemetry backing its own failure mode.**
`.pipeline/HALT` + `.pipeline/HALT.class` (`needs-human` vs `mechanical`) is a real, working
"this needs you" signal that the daemon loop checks and stops on (`halt-marker.ts:13-29`) — this
is the correct pattern in principle. But per Category 1, the write is best-effort and swallows
its own failure with **no compensating event**, so the one case where the operator most needs to
be told something ("your alerting mechanism itself failed to fire") is exactly the case that
produces zero signal anywhere. `sendNotification` (`ui/notifications.ts`) provides a genuine
desktop-notification / terminal-bell fallback, but I did not trace which code paths actually call
it versus merely defining it — **tentative**, not verified as wired to the halt path specifically
(55%, inferred from a single grep hit with no call-site trace). Absent a human at the terminal or
watching desktop notifications, the durable "needs-human" signal an unattended operator will
actually see the next morning is the HALT marker files on disk plus whatever `conduct daemon
status`/dashboard surfaces from them — which is sound *when the write succeeds*.

---

## Summary

**Overall Verdict:** CRITICAL

**Critical findings:** 4
1. `loop_halt` — the terminal halt event — is declared `persist: false` and never reaches
   `.pipeline/events.jsonl`, the documented single spine (`event-sinks.ts:58`). (95%, verified)
2. The audit-trail sink that DOES capture `loop_halt` is a second, differently-shaped,
   independently-parsed file (`AuditRecord`, not `ConductorEvent`) with a lossy, sometimes-wrong
   translation (`step` hardcoded to `'build'` for all halts) — the event-spine skill's own
   named anti-pattern. (92%, verified)
3. `rebase_conflict_halt` reaches NO sink (render/persist/audit all false) — a named, documented
   halt condition with zero durable telemetry anywhere except free-text `.pipeline/HALT` body.
   (90%, verified)
4. `writeHaltMarker`, the sole "this needs you" write, is best-effort and silently drops on I/O
   failure with no compensating event — the alerting mechanism's own failure is invisible.
   (90%, verified)

**Important findings:** 10 (listed above — dead-code halt counting in cost-rollup; no fsync +
silent line-drop on the spine; 35 empty-catch sites uncounted for individual severity;
unstructured/unleveled daemon.log; 1-generation log rotation; no daemon-wide correlation id on
events; feature-identity-by-path breaking under documented worktree deletion; no
event-to-provider-transcript joining id; no daemon-wide health/liveness event; asymmetric
progress-line diagnosability between terminal glance and post-hoc event read)

**Minor findings:** 6

**Net judgment:** This repository's event-spine architecture is unusually well-designed
*everywhere except the halt path* — the exact path the assignment's incident scenario runs
through. Step/gate/cost telemetry is genuinely strong (structured, persisted, rollup-friendly,
crash-tolerant-by-degradation). But the single highest-value event for the stated job — "why did
this halt" — was declared `persist: false` at design time (a real decision, visible in
`event-sinks.ts`, not an oversight that crept in silently), was moved to a second schema instead
of staying on the spine, and its write mechanism swallows its own failures. An operator following
the documented "check `.pipeline/events.jsonl`" procedure literally cannot answer the question
this whole architecture exists to let them answer, for the one event class that matters most.
