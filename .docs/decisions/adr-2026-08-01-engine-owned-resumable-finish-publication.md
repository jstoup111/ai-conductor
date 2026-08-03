---
status: APPROVED
date: 2026-08-01
supersedes: conflicting clauses of adr-2026-07-07-finish-record-primitive and adr-2026-07-11-finish-step-engine-completion-machinery
deciders: James Stoup
approved: 2026-08-01
issues: "jstoup111/ai-conductor#1172"
---

# ADR: Engine-owned resumable FINISH publication from observed state

## Context

FINISH currently delegates a long sequence of deterministic publication actions to one judgment session and validates the result afterward. The completion predicate can name missing state precisely, but it runs only after the expensive dispatch. Any non-recording FINISH miss can then enter broad remediation and route to BUILD even when implementation evidence remains valid.

Existing decisions incrementally moved presentation repair and completion checks into engine machinery while deliberately retaining agent-only ownership of `finish-choice`, shipped-record creation, and the final recorder invocation. That split was appropriate for the narrower incidents, but it conflicts with the newly approved requirement that deterministic publication be coherent, resumable, and independent of prompt compliance.

A separately approved, active specification makes a bot-owned release PR the sole writer of changelog and version state and retires the legacy implementation-PR token finalizer. This ADR therefore excludes release-note, changelog, semver, and version-cut transitions from FINISH ownership.

Verified constraints:

- A draft implementation PR already exists from SHIP entry on the normal path, making PR identity available before FINISH judgment.
- Git, GitHub, shipped-record verification, push evidence, presentation repair, and finish recording already have injectable or deterministic seams.
- Interactive inline and unattended execution share `Conductor` and `DefaultStepRunner`; mode policy can vary without duplicating completion semantics.
- The fail-closed durable-shipment-evidence contract remains authoritative, and no path may merge a PR.

## Options Considered

### Option A: Preflight-only hardening

- **Pros:** Small change; catches known gaps earlier.
- **Cons:** Leaves the mechanical tail judgment-owned, does not provide coherent resume, and retains broad post-dispatch recovery.

### Option B: Engine-owned publication coordinator derived from observed state

- **Pros:** Deterministic, resumable, idempotent, shared across modes, and keeps judgment limited to PR prose.
- **Cons:** Supersedes prior agent-only recording ownership and adds a typed lifecycle boundary across several existing primitives.

### Option C: Failure-classifier-only repair

- **Pros:** Prevents publication gaps from returning to BUILD.
- **Cons:** Still discovers deterministic gaps after judgment and retains repeated mechanical orchestration.

## Decision

Choose Option B.

### D1 — One engine-owned coordinator, one observed-state model

Add a FINISH publication coordinator invoked by the shared conductor immediately before and after the judgment dispatch. It derives a closed snapshot from authoritative repository and external evidence: publication intent, branch/upstream state, PR identity and presentation, changelog finalization, durable shipped record, and final outcome record.

The coordinator does not introduce an independent progress ledger. On every entry it observes and verifies existing effects, computes the next incomplete transition, performs at most that safe transition, and re-observes before advancing. Existing markers remain outputs of their established primitives; they are not trusted without their corresponding git or GitHub evidence.

### D2 — Publication intent is explicit and mode-owned

The coordinator never guesses a ship outcome.

- Interactive conduct supplies operator-confirmed intent through the FINISH interaction.
- Daemon mode supplies the existing authorized PR-only policy.
- Foreground automatic mode supplies its existing safe PR-or-keep policy based on configured remote and authenticated publication capability.
- Merge-local, discard, merge, and any ambiguous or destructive choice require operator authority and cannot be synthesized unattended.

An absent or refused intent produces a typed human-decision result and leaves the final marker unwritten. This replaces marker absence as an overloaded refusal signal with an explicit refusal/halt disposition while preserving fail-closed completion.

### D3 — Mechanical transitions move out of the judgment session

The coordinator owns ordered, idempotent invocation and verification of existing publication capabilities:

1. establish or reuse the draft PR identity when PR publication is intended;
2. consume the repository's resolved release-readiness result without authoring changelog or version state;
3. create or verify the durable shipped record and commit/push it;
4. invoke the judgment dispatcher once when reader-facing PR prose is not accepted;
5. apply existing deterministic presentation repair and ready-for-review behavior;
6. record the final outcome only after all required evidence is coherent.

Each transition is observe-before-act and verify-after-write. A retry resumes at the first incomplete transition and never repeats a verified external effect.

### D4 — Judgment remains authoritative for reader-facing prose

The provider session receives a bounded PR-title/body task against the already-known PR and final branch content. It does not push, finalize the changelog, create shipped evidence, or write completion markers. Existing prose-quality checks remain blocking, with their bounded fallback policy unchanged unless a later ADR explicitly changes it.

Interactive Claude conduct remains conversational: the host gathers intent and can discuss prose or blockers, while the coordinator performs only the resulting deterministic actions.

### D5 — Typed failure routing is local to FINISH unless implementation evidence is invalid

Coordinator and completion results use exhaustive dispositions:

- `publication_retry` — a safe publication transition failed or external state is transient; remain in FINISH;
- `implementation_invalid` — current BUILD or SHIP evidence is invalid; route to BUILD with that evidence;
- `human_required` — authority, ambiguity, destructive action, or indeterminate safety; HALT without guessing;
- `complete` — all durable and external publication evidence is coherent.

Generic remediation cannot reinterpret `publication_retry` as BUILD work. Only `implementation_invalid` permits BUILD routing.

### D6 — Prior decisions are narrowed, not discarded wholesale

- Supersede `adr-2026-07-07-finish-record-primitive` only where it requires the agent to be the sole invoker/owner of final recording. Its argument parsing, absolute-path protection, evidence verification, ordered atomic writes, and fail-closed behavior remain reusable.
- Supersede `adr-2026-07-11-finish-step-engine-completion-machinery` only where it assigns the ship/keep recording action and mechanical FINISH tail to the agent. Its order-gated presentation repair, injectable checks, and prose-quality ownership remain.
- Do not amend or implement `adr-2026-07-25-changelog-pr-link-finalization`; the separately approved bot-owned release-PR decision supersedes it and owns removal of the obsolete finalizer.
- Preserve `adr-2026-07-25-fail-closed-durable-shipment-evidence`, SHIP-start draft PR behavior, mergeability-first finish, and the prohibition on automatic merge.

## Consequences

### Positive

- Mechanically knowable gaps surface before judgment, and mechanical progress resumes without replay.
- Normal FINISH needs at most one quality judgment pass.
- Publication-only failures cannot churn BUILD.
- Interactive and unattended modes share completion truth while retaining different authority policies.
- Existing deterministic primitives and injected adapters are consolidated rather than reimplemented.

### Negative

- The coordinator becomes a load-bearing orchestration component and needs exhaustive transition tests.
- Prior ADR ownership boundaries must be superseded explicitly and documentation updated together.
- GitHub or git state can change between observation and action; every transition therefore pays a verify-after-write cost.
- The central conductor is a high-overlap file, so wiring should be minimal and delegated to a focused module.

### Follow-up Actions

- [ ] Define the closed publication snapshot, intent, transition, and disposition types.
- [ ] Implement the observe/advance/re-observe coordinator over injected existing adapters.
- [ ] Narrow the FINISH judgment prompt and preserve interactive intent capture.
- [ ] Replace generic FINISH remediation entry with typed disposition routing.
- [ ] Add unit, acceptance, and real-boundary smoke coverage without third-party calls in default suites.
- [ ] Update FINISH, daemon, and recovery documentation without reintroducing feature-owned changelog or version mutation.

## Verify-Claims Ledger

### Claims

- [verified] SHIP-start draft publication provides PR identity before FINISH on the normal path — read `ship-draft-pr.ts` and its approved ADR.
- [verified] current completion checks validate changelog, durable shipment, push, and presentation only after FINISH dispatch — read `artifacts.ts` and `conductor.ts`.
- [verified] current FINISH failure handling can invoke generic remediation and select BUILD — read the FINISH/as-built remediation branch in `conductor.ts`.
- [verified] current deterministic primitives expose injectable git/GitHub seams or pure file boundaries suitable for composition — read the named engine modules and their tests.

### Assumptions

- None pending. The operator explicitly chose engine-owned resumable publication, confirmed continued interactive conduct, and approved product requirements that constrain unattended authority.

Verdict: CLEAR
