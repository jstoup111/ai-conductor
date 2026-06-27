# Architecture Review (As-Built): Phase 9.3 — Engineer Redesign

**Date:** 2026-06-26
**Mode:** as-built — code-vs-APPROVED-ADR drift sweep; no new design, no feasibility/domain pre-checks
**Reviewer:** architecture-review skill (§12 SHIP compliance gate)
**APPROVED ADRs checked:** ADR-005, ADR-008, ADR-009, ADR-010
**SUPERSEDED ADRs (not authoritative):** ADR-004, ADR-007

---

## Verdict: BLOCKED

Two blocking ADR-008 violations exist in the shipped code. The production path constructs a **Node
readline REPL** and uses **ClaudeProvider** (which spawns `claude` via `execa`) for routing inference.
Both are explicitly forbidden by ADR-008's locked mechanism. A third violation couples the engineer
core to the concrete `ClaudeProvider` class, violating the spirit of the agent-hosted execution model.
No shipping-blocking violations were found in authoring, handoff, isolation, or liveness.

---

## Blocking Violations

### VIOLATION 1 — Node readline REPL in the production path (ADR-008, Loop/FR-1/FR-2)

**Files and lines:**

- `src/conductor/src/engine/engineer-cli.ts:83–94`

```
83  const readline = await import('node:readline');
84  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
85  const io: EngineerIO = {
86    prompt: (): Promise<string | null> =>
87      new Promise((resolve) => {
88        rl.question('engineer> ', (line) => resolve(line));
89        rl.once('close', () => resolve(null));
90      }),
91    print: (s: string): void => {
92      process.stdout.write(s + '\n');
93    },
94  };
```

**ADR-008 clause violated:**

> **Loop (FR-1/2):** the host agent runs the long-lived loop; **no Node TTY REPL and no `claude -p`
> subprocess** is spawned for routing, authoring, or retro-narrative. A test asserts zero authoring
> subprocesses.
> *(ADR-008 § Mechanism (locked), bullet 1)*

**Analysis:** The production path in `dispatchEngineer` (the real entry point, invoked when
`argv[2] === 'engineer'` and no `deps.io` is injected) creates a `readline.createInterface` bound to
`process.stdin` / `process.stdout` and enters a `for(;;)` loop driven by that REPL. This is precisely
the "Node TTY REPL" substrate the ADR forbids. ADR-008's ADR-008 follow-up checklist (lines 132–133)
leaves this box unchecked: *"Loop runs agent-hosted; test asserts no `claude -p`/authoring subprocess
spawned **and** no Node readline REPL substrate remains."*

The injected-`io` path (test/non-interactive callers) avoids readline, but that path is never taken in
production — `deps` is always `undefined` when invoked from the CLI (see `index.ts` dispatch).

---

### VIOLATION 2 — ClaudeProvider used for routing inference (ADR-008, Routing/FR-3/FR-4/FR-5)

**Files and lines:**

- `src/conductor/src/engine/engineer-cli.ts:12` — import
- `src/conductor/src/engine/engineer-cli.ts:72` — construction
- `src/conductor/src/engine/engineer-cli.ts:78,96` — passed to `runEngineerMode`
- `src/conductor/src/engine/engineer/loop.ts:27` — `LLMProvider` type
- `src/conductor/src/engine/engineer/loop.ts:163–196` — `routingProvider` adapter wraps `deps.provider.invoke()`
- `src/conductor/src/engine/engineer/loop.ts:174` — `await deps.provider.invoke({ prompt, sessionId: uuidv4(), resume: false })`
- `src/conductor/src/execution/claude-provider.ts:56` — `execa('claude', args, ...)` — spawns the `claude` binary

**ADR-008 clause violated:**

> **Routing (FR-3/4/5) — RETAINED from ADR-007:** ... Inference is the **host agent's in-chat
> reasoning** over the registry (**no spawned `claude`**). ... (Option B — "keep the Node loop +
> ClaudeProvider, just stop spawning `claude -p`" — was explicitly **REJECTED**.)
> *(ADR-008 § Mechanism (locked), bullet 2; § Options Considered, Option B)*

**Analysis:** `engineer-cli.ts` constructs `new ClaudeProvider()` and passes it to `runEngineerMode`
as `provider`. Inside `loop.ts` the `routingProvider` adapter wraps `deps.provider.invoke(...)`,
which calls `ClaudeProvider.invoke()` → `execa('claude', args)`, spawning a `claude` subprocess for
every routing call. This is precisely Option B, which ADR-008 explicitly rejected:

> **B: Keep the Node loop + `ClaudeProvider`, just stop spawning `claude -p`.** *Rejected* — the
> provider is a **one-shot** call, so authoring stays a pipeline with **no clarity loop**; it also
> keeps the autonomy framing. Removing the spawn alone does not restore interactive DECIDE.

Additionally, `loop.ts` comment at line 172 acknowledges this: *"the real ClaudeProvider emits `claude
--session-id <id>`, which the CLI rejects with 'Invalid session ID.' when the field is absent"* —
confirming the provider is wired and running as a real subprocess launcher.

The ADR-008 follow-up checklist (line 133) is explicitly unchecked: *"the one-shot `ClaudeProvider`
authoring path is removed."* (The routing use-case is the same violation class.)

---

### VIOLATION 3 — No agent-hosted entry point exists; the REPL is the only production path

**Files and lines:**

- `src/conductor/src/engine/engineer-cli.ts:67–98` — `dispatchEngineer` entire production path

**ADR-008 clause violated:**

> **A (chosen): Agent-hosted, in-chat, human-gated loop with clarity loops.** The host agent runs the
> loop, reasons about routing directly, and drives the real DECIDE skills in the chat
> **interactively**... No Node TTY REPL, no `claude -p`.
> *(ADR-008 § Options Considered — Execution model, Option A)*

**Analysis:** There is no skill file, no host-agent entry point, and no agent-loop primitive in the
shipped code. The single production invocation path is the Node readline REPL built in
`dispatchEngineer`. ADR-008 mandates that the *host agent* (the Claude session, running the
`/engineer` skill or equivalent) drives the loop — not a Node process. The shipped design is the
inverse: Node owns the loop and the host agent would need to be invoked as a subprocess (`claude -p`),
which is the exact pattern ADR-008 was designed to eliminate. ADR-008 follows up (line 131): *"Loop
runs agent-hosted"* — there is no agent-hosted path in the current code.

---

## Non-blocking Observations (not violations — noted for completeness)

- **ADR-009 (intake port):** The `intake/` directory (`port.ts`, `claude-session.ts`,
  `idempotency.ts`) exists and defines the port interface. However, `loop.ts` does not import
  `IntakePort` for the actual idea-capture loop (`io.prompt()` calls bypass the port). The `import
  type { IntakePort }` on `loop.ts:29` is present but the port is not used in `runEngineerMode`.
  This is a latent inconsistency (the intake port is defined but not wired into the loop body),
  but does not rise to a blocking ADR-008 violation on its own — the port/Envelope wiring is an
  ADR-009 follow-up item that was not fully completed.

- **ADR-010 (pidfile lock):** `ensureRunning` is imported and called correctly (fire-and-forget,
  errors swallowed, `launchFn` injectable). No violation found.

- **ADR-005 (non-autonomy):** The engineer does not import build/pipeline or merge entry points.
  `runAuthoring` is not an autonomous build path. `ensureRunning` is fire-and-forget. No violation
  found.

---

## Keep (Compliant Primitives — Must NOT Be Touched by Rework)

The following shipped components are compliant with the approved ADRs and must be preserved
surgically in any conformance fix:

| Component | File(s) | ADR basis | Why keep |
|---|---|---|---|
| `makeProductionDecide` seam | `engineer-cli.ts:19–31` | ADR-008 FR-6 | Correctly gates each DECIDE step through `io.prompt()`; no subprocess; operator provides the artifact. |
| `runAuthoring` | `engineer/authoring.ts:275–409` | ADR-008 FR-6, C1, C2 | Gates brainstorm/stories/plan in order; calls injected `decide` seam; never spawns `claude`; uses `AuthoringGuard`; writes real artifacts; commits on `spec/<slug>` branch. |
| `AuthoringGuard` | `engineer/authoring-guard.ts` | ADR-008 FR-11 / C1 | Path-prefix write guard; blocks writes outside canonical target root. |
| `resolveTargetRepo` | `engineer/target.ts` | ADR-008 FR-11 | No-cwd-fallback canonical path resolution from registry (ADR-004 invariant retained). |
| `routeIdea` + `handleGateResponse` | `engineer/routing.ts` | ADR-008 FR-3/4/5 | Routing discriminated union; exhaustive switch; type-enforced zero-writes-on-decline; the *function* is correct — only its *substrate* (ClaudeProvider caller) violates ADR-008. |
| `openSpecPr` + ledger | `engineer/handoff.ts`, `engineer/authored-ledger.ts` | ADR-008 FR-7 | Existing PR machinery; no-remote non-fatal fallback; no `gh pr merge`. |
| `ensureRunning` wiring | `engineer/loop.ts:458–468` | ADR-005, ADR-010 FR-21 | Fire-and-forget; errors swallowed; injected launch spy; no lifecycle ownership. |
| Intake port definitions | `engineer/intake/port.ts`, `claude-session.ts`, `idempotency.ts` | ADR-009 | Port interface is correctly shaped; `claude-session` adapter is the only wired implementation. |
| `createEngineerStoreReader`, `lessonStore`, `buildAuthoringPrompt` | `loop.ts`, `authoring.ts` | ADR-006 flywheel | Read-only store access; lesson selection; digest embedded in prompt. |
| `makeProductionGh` | `engineer-cli.ts:55–60` | ADR-008 FR-7 | `gh` runner via `execFile`; correct CWD injection. |
| Pidfile / `ensureRunning` module | `engine/daemon-lock.ts` | ADR-010 | `O_EXCL` mutex + `kill(pid,0)` liveness — not yet fully implemented (follow-up items unchecked), but the wiring in `loop.ts` is correct. |

---

## Rework Scope (Surgical — Violations Only)

The conformance fix is narrowly scoped to the two blocking violations:

1. **Remove the Node readline REPL** from `engineer-cli.ts` production path. The `io` / `EngineerIO`
   interface and the `makeProductionDecide` seam are correct — only the readline REPL construction
   (lines 83–97) and the `dispatchEngineer` production branch need replacement. The replacement is a
   skill file (`skills/engineer/SKILL.md`) that drives `runEngineerMode` through the host-agent chat
   session, not a Node readline loop.

2. **Remove the `ClaudeProvider` routing call** from `loop.ts`. The `routingProvider` adapter
   (lines 163–196) wraps `deps.provider.invoke()` to call `claude` as a subprocess. ADR-008 mandates
   that routing inference is *the host agent's in-chat reasoning*, not a spawned `claude`. The
   `routeIdea` function itself (the pure ranking logic) is fine; the violation is wiring it to a
   `ClaudeProvider` caller. The fix is to replace the provider-based `routingProvider` with an
   in-chat prompt that the host agent answers as part of the conversation, removing `LLMProvider`
   from `EngineerDeps` entirely.

**Do NOT change:** `runAuthoring`, `AuthoringGuard`, `resolveTargetRepo`, `routeIdea`,
`handleGateResponse`, `openSpecPr`, `ensureRunning` wiring, intake port definitions, or any test
that asserts no authoring subprocess.

---

## Gate Status

| Check | Status | Evidence |
|---|---|---|
| No Node readline REPL (ADR-008 Loop/FR-1/FR-2) | **FAIL** | `engineer-cli.ts:83–94` — `readline.createInterface` + `rl.question` loop |
| No `claude -p` / ClaudeProvider for routing (ADR-008 Routing/FR-3) | **FAIL** | `engineer-cli.ts:72` + `loop.ts:174` + `claude-provider.ts:56` |
| Agent-hosted entry point exists (ADR-008 Option A) | **FAIL** | No skill file; only production path is the readline REPL |
| `runAuthoring` uses injected `decide` seam, no subprocess (ADR-008 FR-6/C2) | PASS | `authoring.ts:312–330` — `deps.decide(step)` called; no `execa`/`spawn` |
| Path-prefix write guard (ADR-008 FR-11/C1) | PASS | `authoring.ts:358–363` — `AuthoringGuard.assertWriteAllowed` on every path |
| No-cwd-fallback canonical path resolution (ADR-008 FR-11) | PASS | `target.ts` — registry path used; no fallback to `process.cwd()` |
| PR machinery reuse, no auto-merge (ADR-008 FR-7, ADR-005 FR-10) | PASS | `handoff.ts` + `loop.ts:424–446` |
| `ensureRunning` fire-and-forget, no lifecycle ownership (ADR-005/ADR-010) | PASS | `loop.ts:458–468` — errors swallowed; no retained handle |
| Intake port interface defined (ADR-009) | PASS | `engineer/intake/port.ts` |
| Engineer does not import build/merge entry points (ADR-005 FR-10) | PASS | No pipeline/merge imports in `engineer/` modules |
