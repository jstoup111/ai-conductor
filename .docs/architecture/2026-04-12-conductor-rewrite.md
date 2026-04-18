# C4 Architecture Diagrams: Conductor Rewrite (TypeScript)

Phase 3 of the pluggable harness migration. The conductor is rewritten from a
3100-line bash script (`bin/conduct`) into a typed, layered TypeScript application
with event-driven UI, structured recovery, and backward-compatible state management.

---

## Level 1: System Context

Shows the conductor system boundary, its primary user, and the external systems
it depends on.

```mermaid
C4Context
    title System Context — Conductor (TypeScript Rewrite)

    Person(dev, "Developer", "Solo developer driving features through the SDLC pipeline")

    System(conductor, "Conductor", "TypeScript CLI that orchestrates a 14-step SDLC pipeline, managing state, gates, and recovery")

    System_Ext(claude_cli, "Claude CLI", "AI model invocation via the claude command; executes per-step skill prompts")
    System_Ext(git, "Git", "Worktree creation, branch management, commits, push")
    System_Ext(fs, "Filesystem", "conduct-state.json, .pipeline/ artifacts, .docs/ specs, YAML config, skill definitions")
    System_Ext(node, "Node.js 20+", "Runtime for the TypeScript conductor and ink-based terminal UI")

    Rel(dev, conductor, "Runs via CLI", "npx / node")
    Rel(conductor, claude_cli, "Invokes per step", "execa subprocess")
    Rel(conductor, git, "Manages worktrees and branches", "execa subprocess")
    Rel(conductor, fs, "Reads config, writes state and artifacts", "Node fs")
    Rel(conductor, node, "Runs on", "ES modules")
    Rel(claude_cli, dev, "Returns step output", "stdout/stderr")

    UpdateRelStyle(dev, conductor, $offsetX="-60", $offsetY="-20")
```

---

## Level 2: Container Diagram

The conductor is a single deployable unit with three internal layers. Data flows
downward (Engine -> Execution -> external systems) and events flow upward
(Engine -> UI).

```mermaid
C4Container
    title Container Diagram — Conductor Layers

    Person(dev, "Developer")

    System_Boundary(conductor, "Conductor System") {
        Container(ui, "UI Layer", "TypeScript + ink (React for CLI)", "Terminal dashboard, checkpoint prompts, recovery menus, navigation. Subscribes to engine events.")
        Container(engine, "Engine Layer", "TypeScript", "State machine with 14-step registry. Gates, complexity tiers, recovery, backward navigation, artifact checks.")
        Container(execution, "Execution Layer", "TypeScript + execa", "LLM provider abstraction, Claude CLI subprocess management, session lifecycle, rate limit handling.")
    }

    System_Ext(claude_cli, "Claude CLI")
    System_Ext(git, "Git")
    System_Ext(fs, "Filesystem")

    Rel(dev, ui, "Interacts via terminal", "stdin/stdout")
    Rel(engine, ui, "Emits typed events", "EventEmitter")
    Rel(ui, engine, "Sends user choices", "function calls")
    Rel(engine, execution, "Requests LLM invocation", "async methods")
    Rel(engine, fs, "Reads/writes state and config", "Node fs")
    Rel(execution, claude_cli, "Spawns per-step", "execa")
    Rel(execution, git, "Worktree and branch ops", "execa")
```

---

## Level 3: Component Diagram — Engine Layer

The core of the conductor. The state machine drives a 14-step loop, consulting
gates, complexity tiers, and artifact checks at each transition.

```mermaid
C4Component
    title Component Diagram — Engine Layer

    Container_Boundary(engine, "Engine Layer") {
        Component(conductor_ts, "conductor.ts", "State Machine", "Main loop: gate check -> tier skip -> mark in_progress -> run step -> mark done/failed -> checkpoint -> advance")
        Component(config_ts, "config.ts", "Config Loader", "YAML config loading and validation against schema")
        Component(state_ts, "state.ts", "State Manager", "conduct-state.json read/write; backward-compatible with bash format")
        Component(steps_ts, "steps.ts", "Step Registry", "14 step definitions with ordering and tier-based skip rules")
        Component(gates_ts, "gates.ts", "Gate Enforcer", "Enforces preconditions between steps; blocks progression on unmet gates")
        Component(recovery_ts, "recovery.ts", "Recovery Handler", "Retry / interactive fix / skip / go back / quit logic on step failure")
        Component(complexity_ts, "complexity.ts", "Complexity Assessor", "5-signal assessment producing S/M/L tier for step skipping")
        Component(artifacts_ts, "artifacts.ts", "Artifact Checker", "Verifies expected file artifacts exist for each completed step")
        Component(worktree_ts, "worktree.ts", "Worktree Manager", "Git worktree creation, cleanup, branch association")
        Component(step_runners_ts, "step-runners.ts", "Step Runners", "Per-step Claude invocation functions with prompt construction")
    }

    Rel(conductor_ts, config_ts, "Loads config at startup")
    Rel(conductor_ts, state_ts, "Reads/writes step status")
    Rel(conductor_ts, steps_ts, "Iterates step registry")
    Rel(conductor_ts, gates_ts, "Checks gate before each step")
    Rel(conductor_ts, recovery_ts, "Delegates on step failure")
    Rel(conductor_ts, complexity_ts, "Queries tier for skip decisions")
    Rel(conductor_ts, artifacts_ts, "Validates artifacts after step completion")
    Rel(conductor_ts, worktree_ts, "Creates worktree at pipeline start")
    Rel(conductor_ts, step_runners_ts, "Dispatches step execution")
    Rel(gates_ts, state_ts, "Reads step statuses")
    Rel(gates_ts, artifacts_ts, "Checks artifact existence")
    Rel(recovery_ts, state_ts, "Resets step statuses on back/retry")
    Rel(step_runners_ts, complexity_ts, "Reads tier for prompt tuning")
```

---

## Level 3: Component Diagram — Execution Layer

Abstracts LLM invocation behind a provider interface. Currently one concrete
provider (Claude CLI via execa).

```mermaid
C4Component
    title Component Diagram — Execution Layer

    Container_Boundary(execution, "Execution Layer") {
        Component(llm_provider, "llm-provider.ts", "Interface", "Abstract LLM provider contract: invoke(prompt, options) -> Result")
        Component(claude_provider, "claude-provider.ts", "Claude Provider", "Concrete implementation invoking claude CLI via execa with session management")
        Component(subprocess_ts, "subprocess.ts", "Subprocess Wrapper", "Typed wrapper around execa: spawn, stream stdout/stderr, handle exit codes")
        Component(session_ts, "session.ts", "Session Manager", "Session ID lifecycle, stale detection, rate limit backoff and retry")
    }

    System_Ext(claude_cli, "Claude CLI")

    Rel(claude_provider, llm_provider, "Implements")
    Rel(claude_provider, subprocess_ts, "Spawns claude process")
    Rel(claude_provider, session_ts, "Manages session lifecycle")
    Rel(subprocess_ts, claude_cli, "Executes via execa")
    Rel(session_ts, subprocess_ts, "Monitors process health")
```

---

## Level 3: Component Diagram — UI Layer

Event-driven terminal UI built with ink (React for CLI). The engine emits typed
events; UI components subscribe and render accordingly.

```mermaid
C4Component
    title Component Diagram — UI Layer

    Container_Boundary(ui, "UI Layer") {
        Component(events_ts, "events.ts", "Event Bus", "Typed EventEmitter: step_started, step_completed, step_failed, checkpoint_reached, recovery_needed, navigation_requested")
        Component(subscriber_ts, "subscriber.ts", "UISubscriber", "Interface that UI components implement to receive engine events")
        Component(dashboard_tsx, "terminal/dashboard.tsx", "ink Component", "Status dashboard showing 14 steps with status icons and current progress")
        Component(checkpoint_tsx, "terminal/checkpoint.tsx", "ink Component", "Continue / back / quit prompt at user-approval gates")
        Component(recovery_tsx, "terminal/recovery.tsx", "ink Component", "Retry / interactive fix / back / skip / quit menu on step failure")
        Component(navigation_tsx, "terminal/navigation.tsx", "ink Component", "Numbered step menu for direct backward navigation")
    }

    Rel(dashboard_tsx, subscriber_ts, "Implements")
    Rel(checkpoint_tsx, subscriber_ts, "Implements")
    Rel(recovery_tsx, subscriber_ts, "Implements")
    Rel(navigation_tsx, subscriber_ts, "Implements")
    Rel(subscriber_ts, events_ts, "Subscribes to events")
    Rel(dashboard_tsx, events_ts, "Listens: step_started, step_completed, step_failed")
    Rel(checkpoint_tsx, events_ts, "Listens: checkpoint_reached")
    Rel(recovery_tsx, events_ts, "Listens: recovery_needed")
    Rel(navigation_tsx, events_ts, "Listens: navigation_requested")
```

---

## Key Data Flows

### Main Loop (happy path)

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant UI as UI Layer
    participant Eng as Engine (conductor.ts)
    participant Exec as Execution Layer
    participant CLI as Claude CLI

    Dev->>UI: Start conductor
    UI->>Eng: Initialize (load config, read state)

    loop For each of 14 steps
        Eng->>Eng: Check gate (gates.ts)
        Eng->>Eng: Check tier skip (complexity.ts + steps.ts)
        alt Step skipped by tier
            Eng->>Eng: Mark skipped in state
            Eng-->>UI: Emit step_skipped
        else Step runs
            Eng-->>UI: Emit step_started
            Eng->>Exec: Run step (step-runners.ts)
            Exec->>CLI: Spawn claude with prompt
            CLI-->>Exec: Output + exit code
            Exec-->>Eng: Result
            Eng->>Eng: Check artifacts (artifacts.ts)
            Eng->>Eng: Mark done in state (state.ts)
            Eng-->>UI: Emit step_completed
            Eng->>Eng: Check checkpoint
            opt Checkpoint gate
                Eng-->>UI: Emit checkpoint_reached
                UI->>Dev: Show c/b/q prompt
                Dev->>UI: Choice
                UI->>Eng: User decision
            end
        end
    end
    Eng-->>UI: Pipeline complete
    UI->>Dev: Show summary
```

### Recovery Flow (step failure)

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant UI as UI Layer
    participant Eng as Engine
    participant Rec as recovery.ts

    Eng->>Eng: Step fails
    Eng->>Eng: Mark failed in state
    Eng-->>UI: Emit step_failed
    Eng->>Rec: Enter recovery
    Rec-->>UI: Emit recovery_needed
    UI->>Dev: Show r/i/b/s/q menu

    alt Retry (r)
        Dev->>UI: r
        UI->>Rec: retry
        Rec->>Eng: Re-run same step
    else Interactive fix (i)
        Dev->>UI: i
        UI->>Rec: interactive
        Rec->>Eng: Open shell, then re-run
    else Back (b)
        Dev->>UI: b
        UI->>Rec: back(target_step)
        Rec->>Eng: Mark target pending, downstream stale
        Note over Eng: Loop jumps back to target step
    else Skip (s)
        Dev->>UI: s
        UI->>Rec: skip
        Rec->>Eng: Mark skipped, advance
    else Quit (q)
        Dev->>UI: q
        UI->>Rec: quit
        Rec->>Eng: Save state, exit
    end
```

---

## Project Structure

```
src/conductor/
  src/
    engine/              # Layer 1
      conductor.ts       # State machine + main loop
      config.ts          # YAML config loading
      state.ts           # conduct-state.json I/O
      steps.ts           # Step registry + ordering
      gates.ts           # Gate enforcement
      recovery.ts        # Failure recovery logic
      complexity.ts      # S/M/L tier assessment
      artifacts.ts       # Artifact existence checks
      worktree.ts        # Git worktree management
      step-runners.ts    # Per-step invocation
    execution/           # Layer 2
      llm-provider.ts    # Abstract provider interface
      claude-provider.ts # Claude CLI implementation
      subprocess.ts      # Typed subprocess wrapper
      session.ts         # Session lifecycle
    ui/                  # Layer 3
      events.ts          # Typed EventEmitter
      subscriber.ts      # UISubscriber interface
      terminal/
        dashboard.tsx    # 14-step status display
        checkpoint.tsx   # c/b/q prompt
        recovery.tsx     # r/i/b/s/q menu
        navigation.tsx   # Step selection menu
    types/               # Shared type definitions
    index.ts             # CLI entry (commander)
  test/
    engine/
    execution/
    ui/
    integration/
```
