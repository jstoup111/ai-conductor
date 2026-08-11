# Architecture Coherence Review

**Date:** 2026-08-10
**Scope:** `src/conductor/src/` (106,564 non-test TS LOC across engine/ 295 files, execution/ 9,
ui/ 11, types/ 7, tools/ 3), `.docs/decisions/` (432 records), `HARNESS.md`, `CLAUDE.md`,
`skills/` (29) + `.agents/skills/` (5), `bin/` + `hooks/claude/` (6,813 bash LOC).
Reviewed at commit `58628e858` in a detached worktree.

**Method note:** every finding below carries a confidence % and a basis. `verified` means I read
the cited lines and observed the behavior. `inferred` means derived from adjacent evidence. Where
I could not confirm, I say so and mark the item **tentative**.

---

## 1. Decision Conformance

| Finding | Severity | File:Line | ADR Reference |
|---------|----------|-----------|---------------|
| **D0.** **The corpus's founding ADR is directly contradicted and was never superseded.** `001-harness-architecture.md:4` is `Status: Accepted`; `:19-20` decides: *"Build a custom harness as a pure Markdown skills + agent personas repository, using Claude Code as the execution engine. **No custom runtime.**"* The repository today **is** a custom runtime — 106,564 LOC of TypeScript across 325 modules, with its own CLI, engine, daemon, gates, and event bus. No file in `.docs/decisions/` references or supersedes this ADR (verified: `grep -rl "001-harness-architecture"` returns nothing). | **critical** | `.docs/decisions/001-harness-architecture.md:4,19-20` vs `src/conductor/src/` (325 modules) | `.docs/decisions/001-harness-architecture.md` — Accepted, unsuperseded |
| **D0b.** Same ADR, `:31`: *"4-level enforcement declared per skill: Advisory, Gating, Structural, **Mechanical**."* `EnforcementLevel` still declares all four (`types/steps.ts:44`) but `mechanical` is used by **zero** steps and **zero** skills — a dead union member, same class of defect as D6. | minor | `types/steps.ts:44`; zero uses in `engine/steps.ts` or `skills/*/SKILL.md` | `.docs/decisions/001-harness-architecture.md:31` |
| **D1.** Approved ADR is entirely unimplemented — mandates a new reseal variant in the `ConductorEvent` union declared with `audit: true`; no such event exists in the union, the sink registry, or anywhere in `src/`. `grep -in reseal` over `types/events.ts` + `engine/event-sinks.ts` returns nothing. | important | `types/events.ts` (absent); `engine/event-sinks.ts:9-83` (absent) | `.docs/decisions/adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md:1-5` (Status: APPROVED) |
| **D2.** "Deterministic where possible" — step `enforcement` is declared in two independent places that disagree. `engine/steps.ts` (engine-authoritative, read by `gates.ts:38-40 isGatingStep`) and `skills/*/SKILL.md` frontmatter. 5 verified mismatches. No validation check compares them. | important | `engine/steps.ts` vs `skills/*/SKILL.md`; enforced at `engine/gates.ts:38-40`; override path `engine/skill-resolver.ts:78-80` | CLAUDE.md "Deterministic where possible"; validation check 2 (`test/test_harness_integrity.sh:162`) checks presence only |
| **D3.** "Never add a parallel channel" — the plan/story markdown contract is a de-facto second interchange schema with no single parser. The identical regex `/^\s*\*\*Stories:\*\*\s*` + backtick + `([^\s`]+)` is independently reimplemented in two modules, with a third variant in a third. | important | `engine/shipment-audit.ts:614`; `engine/shipped-record-cli.ts:77`; `engine/daemon-backlog.ts:1263-1280` | CLAUDE.md event-spine principle; `.agents/skills/event-spine/SKILL.md:84-85` ("a field on an artifact we already write … is a new channel wearing an existing file as a disguise") |
| **D4.** "A timestamp stamped into an artifact to be read back later" is named verbatim as the anti-pattern the event-spine skill exists to catch — yet filesystem `mtime` is the load-bearing mechanism for artifact/verdict freshness, complete with a 2-second fudge constant acknowledging the mechanism is unreliable. | important | `engine/artifacts.ts:335-342` (`fileIsFreshSinceSession`: `s.mtimeMs >= sessionStartedAt`), `:379` (`VERDICT_FRESHNESS_FS_TOLERANCE_MS = 2000`), `:3712-3723`; `engine/conductor.ts:1011,1039` | `.agents/skills/event-spine/SKILL.md:3` (description names this exact case) |
| **D5.** `adr-2026-07-26-event-sink-registry-exhaustiveness` — **COMPLIANT.** The mandated `Record<ConductorEvent['type'], SinkDeclaration>` exists and is compile-time total; `verdict_freshness` is now `{render:true, persist:true, audit:true}` as specified. The ADR explicitly declared itself behavior-neutral and deferred routing, so the 17 still-dead types are a *declared* state, not drift. Credit where due. | — (compliant) | `engine/event-sinks.ts:1-9,53` | `.docs/decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md:49-70` |
| **D6.** Residual gap the D5 machinery cannot close: the registry forces every union member to *declare a sink*, but not to *be emitted*. `rebase_resolution_failed` is declared in the union, declared in the sink registry, and asserted by 4 test sites — and is emitted from **zero** production call sites. | minor | `types/events.ts:587`; `engine/event-sinks.ts:70`; emitters: none (verified by exhaustive grep across `src/`) | Same ADR — the exhaustiveness type checks declaration, not emission |
| **D7.** Provider abstraction vs. the stated provider-agnostic scope rule — shared types are hard-typed to one vendor. `AuthenticationReadinessBase.provider: 'codex'` and `SelfHostAuthContext.provider: 'codex'` are string *literals* on the supposedly neutral port, structurally excluding any other provider from readiness/self-host-auth. `SelfHostProviderId` is a closed 2-member union in a file whose own header comment claims to be "Provider-neutral". | important | `execution/llm-provider.ts:69,126`; `engine/self-host/provider-home.ts:1,11,82-85`; `engine/self-host/live-boundary.ts:172-173` | `.agents/skills/scope-check/SKILL.md` (provider-agnosticism question); CLAUDE.md Scope Decisions |

**Confidence:** D1 95% verified. D2 95% verified (mismatch list computed by parsing both sources;
see §2). D3 99% verified (regexes read side by side). D4 95% verified. D5 95% verified.
D6 90% verified (a dynamically-constructed emit would evade grep; I found no such construction,
but cannot prove absence). D7 90% verified (subagent-traced, spot-checked by me).

**On D1 — an important structural caveat, not an excuse.** This repository lands ADRs as
*approved specs ahead of implementation* (the `engineer/land` spec-PR flow; see the recent commit
`9f79ed2c4 spec: land authored artifacts …`). So `Status: APPROVED` does **not** mean "reflected in
code." That convention is defensible on its own terms, but it means the ADR corpus cannot be read as
a description of the system, and nothing in the corpus distinguishes "approved and built" from
"approved and pending." That is the finding, more than the single unimplemented record.
**Confidence 80%, inferred** from the commit-message convention and the 1-day gap between the ADR
date and HEAD — I did not trace the feature's build state.

---

## 2. Cross-Module Consistency

| Concern | Module A | Module B | Consistent? | Notes |
|---------|----------|----------|-------------|-------|
| **Git access port** | `engine/rebase.ts:33-41` — `(args, opts?:{input?}) => Promise<{exitCode,stdout,stderr}>`, **cwd bound at construction** (`makeGitRunner(cwd)`, `:67-80`) | `engine/pr-labels.ts:28-31` — `(args, opts:{cwd}) => Promise<{stdout}>`, **cwd per call, no exitCode** | **No — 4 competing definitions** | Also `engine/setup-triage.ts:23-25` (`(args) => …`, no opts at all) and a private 5th shape in `engine/shipped-record-on-main.ts:1-4`. `engine/rebase-translate.ts:32` adds `GitRunnerWithInput`. `rebase.ts` and `setup-triage.ts` **both export a type named `GitResult`** with identical shape. |
| **Git access — port vs. raw spawn** | 45 files consume some `GitRunner` | 7 files bypass it entirely for raw `child_process`: `engine/park-marker.ts`, `engine/worktree.ts`, `engine/memory-store.ts`, `engine/project-prelude.ts`, `engine/self-host/live-boundary.ts`, `engine/engineer/land-spec.ts`, `engine/engineer/authoring.ts` | **No** | 33 files total touch git. There is no single seam at which git — the system's primary side-effect boundary and implicit global state — can be faked, throttled, or audited. |
| **Rebase-conflict resolution orchestration** | `engine/conductor.ts:9070-9084` and `engine/daemon-rekick.ts:505-519` both call the shared `runGatedRebaseResolution` with byte-identical `onAttempt`/`onSettled` wiring | `daemon-cli.ts:1808-1820` hand-rolls its own attempt counter and resolver loop | **No** | The `daemon-cli` copy emits `rebase_resolution_attempt` but **never** `rebase_resolution_succeeded` or `rebase_resolution_exhausted` (verified: zero matches in `daemon-cli.ts`), so a rebase resolved on that path is terminally silent. Two call sites also duplicate identical wiring that the shared helper could have owned. |
| **Plan-markdown contract parsing** | Shared parsers exist: `engine/plan-task-parse.ts`, `engine/wired-into.ts:18` | But `engine/shipment-audit.ts:614` and `engine/shipped-record-cli.ts:77` each carry a private duplicate of the `**Stories:**` regex | **Partially** | 11 files parse this contract. The shared-parser pattern was started and not finished. |
| **Step `enforcement` declaration** | `engine/steps.ts` (engine-authoritative via `gates.ts:38-40`) | `skills/*/SKILL.md` frontmatter | **No — 5 verified mismatches** | `memory` (step=advisory / skill=gating), `architecture_diagram` (advisory/gating), `architecture_review` (advisory/gating), `assess` (advisory/gating), `remediate` (advisory/gating). For built-in skills the frontmatter value is **read but discarded** (`skill-resolver.ts:92` returns `stepDef.enforcement`) — so today it is documentation drift. It becomes load-bearing the moment a project configures `steps.<name>.skill`, because `skill-resolver.ts:78-80` then lets frontmatter win for any step outside `ENFORCEMENT_LOCKED_STEPS` — which covers only 5 of 26 steps (`:17-25`). |
| **Provider home-directory resolution** | `engine/self-host/provider-home.ts:82-85` — a `HOME_VARIABLE` registry map | `engine/conductor.ts:2971-2972` — inline `provider === 'codex' ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR` ternary | **No** | The god module reimplements the registry it already depends on. |

**Confidence:** 95% verified for all rows (each cited line read directly). The `daemon-cli` missing-
terminal-event claim is 90% verified — proven by absence of the symbol in that file.

---

## 3. Domain Boundary Integrity

| Violation | Severity | File:Line | Crossed Boundary |
|-----------|----------|-----------|-----------------|
| **B1. Value-level circular dependency across the engine/execution boundary.** `engine/plugin-loader.ts:6-7` imports the concrete `ClaudeProvider`/`CodexProvider` **classes** (value imports, not `import type`) from `execution/`; both adapters import the **function** `validateSpawnPermit` back from `engine/provider-runtime.js`; which in turn imports back from `execution/llm-provider.js`. This is a runtime cycle, not a type-only one. | **critical** | `engine/plugin-loader.ts:6-7` → `execution/claude-provider.ts:10` / `execution/codex-provider.ts:22` → `engine/provider-runtime.ts:1-10` | engine ↔ execution, both directions, at value level |
| **B2. The `types/` leaf layer depends upward on `execution/`.** A types layer that imports from an implementation layer is not a leaf, and nothing below it can be compiled or reasoned about independently. | important | `types/events.ts:9` (`from '../execution/llm-provider.js'`), `:10` (`from '../execution/observed-interval.js'`) | types → execution (inverted) |
| **B3. `ui/` and `engine/` are mutually dependent.** `engine → ui` 17 import sites; `ui → engine` 10. `ui/types.ts:15` and `ui/terminal/prompt-host.ts:13` reach directly into `engine/conductor.js`; `engine/conductor.ts` imports `../ui/events.js`. The "UI" layer is not a boundary — it is a peer. | important | `ui/types.ts:10,15`; `ui/terminal/prompt-host.ts:13-14`; `ui/terminal-renderer.ts:12,14`; `engine/conductor.ts` (imports `../ui/events.js`) | ui ↔ engine |
| **B4. The layer split is nominal, not real.** 295 of 325 non-test modules (91%) live in `engine/`. `execution/` (9), `ui/` (11), `types/` (7), `tools/` (3) are thin shells around a single undifferentiated package. `engine/` has no internal subdivision except `engineer/`, `self-host/`, `owner-gate/`, `halt-issues/`, `otel/`. | important | `src/conductor/src/engine/` (295 files) | n/a — absence of a boundary |
| **B5. Provider identity leaks past the adapter boundary into orchestration.** Behavioral (not cosmetic) `provider === 'codex'` branches exist in `engine/`, including one where a third provider would silently receive an **empty** volatile-file exclusion set — a correctness gap, not a missing feature. | important | `engine/self-host/live-boundary.ts:172-173`; `engine/conductor.ts:2130,2888,2971-2972`; `engine/config.ts` (closed error string `"…one of: claude, codex…"`) | execution/ internals → engine/ orchestration |
| **B6. Asymmetric adapters behind a symmetric interface.** `CodexProvider` implements `resolveSelfHostExecutable()`, `prepareSelfHostAuth()`, `readiness()` (`codex-provider.ts:174,178,188`); `ClaudeProvider` implements none of the three. The orchestrator compensates by branching on provider identity rather than on capability. | important | `execution/codex-provider.ts:174,178,188` vs `execution/claude-provider.ts` (absent); compensating branch at `engine/conductor.ts:2130` | LSP violation at the port |

**Confidence:** B1 95% verified (all four import statements read; value-vs-type distinction
confirmed by absence of `import type`). B2 99% verified. B3 95% verified. B4 99% verified (file
counts). B5/B6 88% verified — traced by a subagent and spot-checked by me at the cited lines; I did
not independently read every one of the 55 provider-mentioning files.

---

## 4. Undocumented Pattern Introduction

| New Pattern | File:Line | Existing Pattern | ADR Exists? |
|-------------|-----------|-----------------|-------------|
| **Filesystem-as-IPC control plane.** ~40 distinct bespoke sidecar files under `.pipeline/`, each with its own format and its own reader, used to coordinate steps, gates, and the daemon: `HALT` (32 sites), `task-status.json` (26), `halt-user-input-required` (8), `task-evidence.json` (7), `QUARANTINE` (7), `finish-choice` (6), `REKICK` (6), `DONE` (6), `step-heartbeat` (5), `HALT.class` (4), `wiring-evidence.json`, `rebase-rewrites.json`, `attribution-verdict.json`, `decide-grant.json`, `dispatch-count`, `version-approval`, … | `.pipeline/*` throughout `engine/`; consolidated writer for one of them at `engine/halt-marker.ts:14-16` | **Partially.** No ADR establishes the pattern as a whole. The event-spine skill's exception C (durable state, not occurrence) legitimizes *some* of these individually, but the aggregate — a second, untyped, unversioned control plane parallel to the typed event bus — is undocumented. |
| **Four independent `GitRunner` port shapes** (see §2) | `engine/rebase.ts:33`, `engine/pr-labels.ts:28`, `engine/setup-triage.ts:23`, `engine/shipped-record-on-main.ts:1` | A single injected port was clearly the intent — the pattern exists, it just forked | **No ADR found** establishing a canonical git port |
| **LLM-authored markdown as a typed interchange schema.** Plan/story `**Stories:**`, `**Story:**`, `**Wired-into:**` header fields are a machine-read contract enforced by scattered regex across 11 files, with no schema, no version, and no single validator. Contract violations fail late, at land time. | `engine/wired-into.ts:18`; `engine/plan-task-parse.ts`; `engine/shipment-audit.ts:614`; `engine/shipped-record-cli.ts:77`; `engine/daemon-backlog.ts:1263`; `engine/engineer/coherence-validator.ts:380`; +5 more | The typed `ConductorEvent` union is the codebase's own demonstration of the better pattern | **No ADR found** defining the plan-artifact schema as a contract |
| **`mtime`-based freshness as gate input** (see D4), incl. a 2s tolerance constant | `engine/artifacts.ts:335-342,379,3712-3723` | Event-sourced state via `events.jsonl` | **No ADR found** for the mtime mechanism itself |

**Confidence:** 90% verified for the file inventories (counted by grep over string literals; a
literal built by concatenation would be undercounted, so these are lower bounds). The "no ADR found"
claims are **85%, inferred** — I searched `.docs/decisions/` filenames by keyword and read the
event-spine ADRs, but did not read all 432 records; an ADR may exist under a name I did not match.
**Tentative** on that basis.

---

## 5. Coupling Analysis

| Type | Class/Module | Depends On | File:Line | Severity |
|------|-------------|-----------|-----------|----------|
| **God class + god method** | `Conductor` | 91 import statements; 62 methods; 55 fields declared in the class header block | `engine/conductor.ts:1215` (class), **`:3327-8326` — a single `run()` method of ~5,000 lines** | **critical** |
| **God module** | `engine/artifacts.ts` | 3,881 lines, 94 exports spanning unrelated concerns: artifact glob contracts (`:194,:314`), fs freshness (`:335`), plan/stories path resolution (`:539,:574`), step completion (`:600`), finish-choice markers (`:815`), PR-body regen markers (`:826`), manual-test result parsing (`:1073-1204`), acceptance-RED evidence (`:1220`), wiring evidence + gap taxonomy (`:1309-1340`) | `engine/artifacts.ts:1-3881` | **important** |
| **God file** | `daemon-cli.ts` | 2,387 lines including a hand-rolled duplicate of the rebase-resolution loop | `daemon-cli.ts:1808-1820` | important |
| **Shotgun surgery — adding a step** | `StepName` | 17 source files hard-code ≥3 step-name string literals: `types/steps.ts` (26), `engine/steps.ts` (26), `engine/step-runners.ts` (22, incl. two hand-maintained `Set<StepName>` lists `AUTONOMOUS_STEPS`/`INTERACTIVE_STEPS` at `:88,:117`), `engine/conductor.ts` (18), `engine/skill-invocation.ts` (13), `engine/artifacts.ts` (11), `engine/model-table-metadata.ts` (10), `engine/engineer/authoring.ts` (9), `engine/rebase.ts` (8), +8 more. Plus, outside code: a `skills/<name>/SKILL.md`, the generated HARNESS.md model table, `docs/reference/steps.md`, and validation checks 2/4/5/5a/5b. | `engine/step-runners.ts:88-125`; `engine/steps.ts`; `types/steps.ts` | **important** |
| **Shotgun surgery — adding a provider** | `LLMProvider` | 8–10 files minimum, incl. widening two closed unions (`SelfHostProviderId`, the `'codex'` literals) whose compile errors cascade | `execution/llm-provider.ts:69,126`; `engine/self-host/provider-home.ts:11`; `engine/self-host/live-boundary.ts:172`; `engine/config.ts`; `engine/model-table-metadata.ts:126-129` | important |
| **Ambient global state** | whole engine | 66 `process.cwd()` call sites; 24 files import `child_process`; 33 files invoke git; provider/host config read from `process.env` at 20+ distinct keys with no single config seam | `src/conductor/src/**` | important |
| **Feature envy** | `engine/conductor.ts:2971-2972` | reimplements `provider-home.ts`'s `HOME_VARIABLE` map inline | `engine/conductor.ts:2971-2972` | minor |

**Confidence:** god-class/method metrics 99% verified (line ranges read at both ends: `run()` opens
at `:3327` and the next method `runTestSuiteStep` opens at `:8327`). `artifacts.ts` concern list 95%
verified (export index read). Shotgun counts 95% verified (computed by scripted literal matching —
a lower bound, since dynamically-built step names would not be counted). Ambient-state counts 90%
verified.

---

## 6. Structure Verification

### 6.1 ADR compliance (sampled)

See §1. Of the structurally significant ADRs I sampled and traced to code:

Across 16 ADRs traced to code (11 sampled by a subagent, 5 by me): **12 COMPLIANT, 2 PARTIAL,
2 VIOLATED, 0 unverifiable.** Both PARTIAL cases are self-documented or cosmetic, not real drift.

| ADR | Verdict | Evidence |
|---|---|---|
| `001-harness-architecture` ("No custom runtime") | **VIOLATED — critical** | 325 TS modules / 106k LOC under `src/conductor/src`; ADR is `Accepted` and unsuperseded (D0) |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | **COMPLIANT** | `engine/event-sinks.ts:9` is exactly the mandated `Record<ConductorEvent['type'], SinkDeclaration>`; `verdict_freshness` upgraded to all-three-sinks (`:53`) |
| `adr-2026-08-01-conduct-state-mutation-port` | **COMPLIANT** | `engine/conduct-state-store.ts:24-28` (`apply`/`applyBatch`/`applyCorrection`); `engine/filesystem-conduct-state-store.ts:130,137-142` (lease + `kind:'conflict'`) |
| `adr-2026-07-29-deterministic-build-verification-fanout` | **COMPLIANT** | `engine/steps.ts:184` `prerequisites:['wiring_check','test_suite']`; `:343-349` concurrent BUILD group |
| `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` | **COMPLIANT** | `engine/worktree-prepare.ts:468,521-522` (`core.hooksPath` → `.pipeline/git-hooks`) |
| `adr-2026-06-30-owner-gate-identity-resolution` | **COMPLIANT** | `engine/owner-gate/identity.ts:35,55-57,67-79,83-85` — ordered chain, fail-open |
| `adr-012-durable-intake-ledger-sole-dedup-authority` | **COMPLIANT** | `intake/idempotency.ts` correctly absent; `engine/engineer/intake/ledger.ts` present |
| `adr-2026-07-09-deterministic-evidence-attribution-enforcement` | **PARTIAL** (cosmetic) | CLI shipped as `conduct task start` not `conduct-ts task start` — `cli.ts:488,496-498`; `engine/task-seed.ts:169` |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | **VIOLATED / unimplemented** | no reseal symbol anywhere in `src/` |
| `adr-2026-07-10-intra-step-build-progress-events` | **COMPLIANT** | `build_progress` / `build_no_progress` present in the union and in `event-sinks.ts:41-43` |
| CLAUDE.md "extend the event spine" | **PARTIAL** | spine is real and well-built, but ~40 `.pipeline/` sidecars + the markdown contract form an undocumented second control plane (§4) |
| CLAUDE.md "deterministic where possible" | **PARTIAL** | see §6.4 |

**Confidence 90%, verified** for the four traced rows.

### 6.2 Undocumented decisions

Four significant patterns with no ADR found: the `.pipeline/` filesystem control plane, the git-port
fork, the plan-markdown interchange schema, and mtime-as-freshness. See §4. **85%, inferred /
tentative** — negative claims over a 432-record corpus I did not read exhaustively.

### 6.3 Stale ADRs and corpus navigability

Measured over all 432 records (scripted parse, **95% verified**):

| Property | Measurement |
|---|---|
| Total records | 432 |
| Directory contents | **Not purely ADRs.** 173 of 432 (40%) are `architecture-review-*` (160) / `review-*` (7) / freeform review transcripts (6) co-located with actual decision records, with no separating convention |
| Disposition field | **Two vocabularies with no convention linking them:** ADRs use `Status:` (269 files), architecture-reviews use `Verdict:` (170 files) |
| Files with **no** header-parseable disposition (either field) | **4 of 432 (<1%)** — `architecture-review-2026-07-12-daemon-halts-a-build…`, `architecture-review-as-built-2026-06-26-phase-9.3-engineer-redesign`, `architecture-review-prd-audit-kickback-preserves-task-status`, `review-per-task-work-happened-floor` |
| `Status:` vocabulary | 5 competing values: `approved` (248), `superseded` (25), `proposed` (2), `accepted` (1), `active` (1) |
| Markdown form of the field | 3 variants: `**Status:**`, `- **Status:**`, bare `status:` (YAML-style) |
| Filename conventions | **5 forms:** `adr-YYYY-MM-DD-*` (238), `architecture-review-*` (160), `adr-NNN-*` (15), `review-*` (7), `NNN-*` (5), other (7) |
| Superseded with a resolvable successor pointer | **24 of 24 (100%)** — see correction note below |
| Successor back-references (`Supersedes:`) | **17 of 17 unique successors (100%)** |
| Index / README / table of contents | **NONE** |

**⚠ Correction — two figures in an earlier draft of this section were wrong, and the corrected
results are materially better than what I first reported.** Recording both the error and the fix,
because the method failure is itself instructive:

1. *Claimed:* "176 of 432 (41%) have no parseable status." *Actual:* **4 of 432.** My regex accepted
   only `Status:`, but the 170 architecture-review documents use `Verdict:`. The real finding is
   **two disposition vocabularies**, not missing data.
2. *Claimed:* "only 12 of 21 superseded ADRs name a successor; 9 dangling." *Actual:* **24 of 24
   carry a resolvable `**Superseded by:**` pointer, and all 17 unique successors carry a matching
   `**Supersedes:**` back-reference.** My regex was case-sensitive (`[Ss]uperseded`) and missed the
   all-caps `SUPERSEDED by` inline form, and mis-captured `**` as the pointer from the bold
   `**Superseded by:**` form. Verified by reading all 24 Status lines directly.

**Supersession discipline in this corpus is excellent and I incorrectly reported otherwise.** Where
an ADR is marked superseded, the bidirectional link is complete. That makes finding **D0** the
sharper problem: the mechanism works, but it was never applied to the one decision that matters most.

**Staleness — real but narrow.** A 30-ADR random sample yielded 58 unique referenced `.ts`
basenames, of which **54 (93%) still exist**; 2 of the 4 misses were method artifacts (files outside
`src/conductor/src`) and 1 was a *correctly executed* removal (`adr-012` mandated deleting
`intake/idempotency.ts`, which is indeed gone). Only **1 genuine stale reference** surfaced:
`adr-2026-07-23-commit-movement-liveness-floor.md:78` cites `attribution-enforcement.ts:183-190`
and the symbol `detectZeroWorkProduct` as present-tense verified fact — neither the file nor the
symbol exists anywhere in the tree. So **file-level citations are mostly sound**; I am withdrawing
any implication of corpus-wide citation rot.

**The live risk is *line-number* citation, not filename citation.** **134 of 432 ADRs (31%) cite
`conductor.ts`**, and the sampled ones cite it *by line number* into what is now a 9,930-line file
that no reader can spot-check. Concretely,
`adr-2026-07-26-event-sink-registry-exhaustiveness.md:16-30` cites `artifacts.ts:482-492`,
`artifacts.ts:1967`, `artifacts.ts:2021`, `artifacts.ts:1869`, `conductor.ts:4104-4114`,
`daemon-cli.ts:1971-1973` — and the same ADR's own premise ("57 `ConductorEvent` members") is now
70. Every line-number citation in that record is stale, three weeks after it was written.
**Confidence 90%, verified** for the cited record; **inferred** that the pattern generalizes to the
other 133, which I did not each re-verify — **tentative** on the generalization.

**Verdict on navigability: hard to navigate, but healthier than it first appears.** The corpus is
well-maintained where it is maintained — supersession is 100% bidirectional, and 428 of 432 records
carry a disposition. What is missing is *findability*, not integrity: 432 records with no index,
five filename conventions, two disposition vocabularies (`Status:` vs `Verdict:`) with three
markdown spellings between them, and 40% of the directory being review transcripts shelved
alongside decision records with nothing marking which is which. A reader — or a tool — cannot
mechanically answer "what is the current decision about X?", not because the links are broken but
because there is no entry point and no type discriminator. Two further caveats compound it: because
the repo lands ADRs *before* implementation (§1), a correctly-parsed `Status: APPROVED` does not
establish that the code does what the record says; and per **D0**, the corpus's own root decision
has been contradicted for months without anyone invoking the (working) supersession mechanism.

### 6.4 The determinism gap — quantified

CLAUDE.md's first design principle is "Deterministic where possible; LLM only where necessary,"
with the corollary "never rely on prompt discipline for something machinery can enforce." The
codebase honours this in impressive places — the compile-time-total `EVENT_SINKS` registry
(`engine/event-sinks.ts:9`) is a textbook instance of the principle, and the ADR that created it
argues from the principle explicitly.

The gap, sized from what I verified:

1. **CLAUDE.md self-declares 5 prose-only rules that should be machinery** (`CLAUDE.md:52-125`,
   Daemon Operations Safety), closing with: *"the durable fix for each of these is machinery … these
   prose rules are the interim guard until that machinery exists."* Each rule documents a failure
   that already destroyed state (74 worktrees deleted; false `no_task_progress` stalls; a feature
   re-dispatched forever). **5 of 5 remain prose.** *Verified 99% — read directly.*
2. **The plan/story markdown contract is enforced by prompt discipline plus late-failing regex**
   (§4). Three of the operator's own recorded lessons are contract-shape violations that machinery
   could reject at authoring time rather than at land time. *Verified 95%.*
3. **Step `enforcement` has two sources of truth and no consistency check** (§2, D2) — the exact
   "two hand-maintained lists" failure mode that `adr-2026-07-26` fixed for events, unfixed here.
   The remedy is the same one already proven in this repo. *Verified 95%.*
4. **`mtime` — an ambient, tolerance-requiring filesystem property — is a gate input** (D4).
   *Verified 95%.*
5. **`writeHaltMarker` is best-effort and swallows all write failures** (`engine/halt-marker.ts:36-45`),
   while the corresponding `loop_halt` event is `persist: false` (`engine/event-sinks.ts:58`). A failed
   HALT write leaves the durable record only in the audit sink. *Verified 90%; flagged as a boundary
   observation — durability is properly the observability reviewer's call.*

**Net judgement:** the principle is applied *reactively and well* — each time a specific failure
recurs, real machinery gets built for that specific failure. What is missing is the *proactive*
application: the recurring structural classes above (dual-source-of-truth lists, untyped text
contracts, ambient filesystem state) are each one generalization away from machinery this repo has
already demonstrated it can build. **Confidence 80%, inferred** — this is a judgement about
trajectory, not an observation. **Tentative.**

---

## Summary

**Critical findings:** 3
**Important findings:** 16
**Minor findings:** 4

**Verdict:** CRITICAL

*Raised from NEEDS_WORK on the corrected evidence.* Finding **D0** meets the persona's own bar
exactly — "code does the opposite of a documented decision": `001-harness-architecture.md` is an
`Accepted`, never-superseded ADR whose central choice is *"No custom runtime,"* and the repository
is now a 106k-LOC custom runtime. The other two criticals (the 5,000-line `run()` method and the
`engine ↔ execution` value-level cycle) are severe structural decay in their own right.

*Read this verdict as "the map must be reconciled with the territory," not "the system is broken."*
The runtime was almost certainly the right call; nothing here argues otherwise. The defect is that
the decision was never written down, so the corpus's root record still tells a new reader — human or
agent — the opposite of what is true.

**Key concerns (narrative):**

This is a codebase with an unusually strong architectural *conscience* and an unusually weak
architectural *skeleton*. The stated principles are correct, the event spine is genuinely well
designed, and `EVENT_SINKS` proves the team can convert a recurring mistake into compile-time
machinery. But 91% of the code lives in one undifferentiated `engine/` directory, the nominal
layers are contradicted by a value-level `engine ↔ execution` import cycle and by a `types/` layer
that depends upward on `execution/`, and `Conductor.run()` is a single ~5,000-line method inside a
9,930-line file that 134 ADRs cite by now-meaningless line numbers.

The drift trajectory is legibility collapse, and the ADR corpus shows it precisely — though not
where I first looked. Its *integrity* is good: supersession is 100% bidirectional and 428 of 432
records carry a disposition. Its *findability* is not: 432 records, no index, five filename
conventions, two disposition vocabularies, and 40% review transcripts shelved among decision
records. And the one decision that most needed the supersession mechanism never got it — the
founding ADR still declares "No custom runtime" over a 106k-LOC runtime. Combined with the
land-ADRs-before-code convention, the corpus cannot tell a reader what is decided, what is built, or
what is still true, which means each new decision is made with less context than the last.

Second, the "never add a parallel channel" rule is winning at the schema level and losing at the
system level. Nobody has forked `ConductorEvent`. But ~40 bespoke `.pipeline/` sidecars, a
regex-parsed markdown interchange contract spread across 11 files, and `mtime` used as a gate input
together constitute exactly the untyped second control plane the rule exists to prevent — assembled
one individually-defensible file at a time.

Third, the same-concern-N-ways pattern is the leading indicator to watch: four incompatible
`GitRunner` definitions forcing an alias inside the god module, three rebase-resolution
implementations of which one silently drops its terminal event, three copies of the `**Stories:**`
regex, and two disagreeing sources of truth for step `enforcement`. Each is small; the pattern is
not. The highest-leverage responses are all ones this repo has already proven it can execute:
supersede `001-harness-architecture.md` with an ADR that describes the runtime that actually exists,
decompose `Conductor.run()`, make `steps.ts` the single generated source for everything step-shaped,
collapse the four git ports to one, give the plan artifact a real parsed-once schema, and give the
ADR corpus a generated index that separates decisions from reviews.

**A note on this review's own reliability.** Two figures in §6.3 were wrong in my first pass and are
corrected in place, with the method error recorded — both errors were case- and markdown-sensitivity
bugs in my own regexes, and both had made the corpus look *worse* than it is. I have left the
correction visible rather than silently editing, because a reviewer who reports only clean numbers
gives you no way to calibrate the rest. Findings I could not fully verify are marked **tentative**
and should be re-checked before anyone acts on them: the "no ADR exists for this pattern" claims in
§4 (negative claims over a corpus I did not read exhaustively) and the determinism-trajectory
judgement in §6.4.
