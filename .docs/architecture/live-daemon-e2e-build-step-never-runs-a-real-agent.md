# Components: Live daemon E2E build step never runs a real agent

**Last updated:** 2026-08-04
**Scope:** To-be view for `live-daemon-e2e-build-step-never-runs-a-real-agent`
(jstoup111/ai-conductor#1311, Tier M, technical track). Gives the live daemon E2E
fixture its own provisioned provider home so a dispatched harness step command
resolves, and makes an unresolvable step command fail by name — before spend at the
fixture boundary, and at the provider boundary for every other caller.

## As-is: why the build step returns in 43 ms

```mermaid
graph TD
    Smoke["daemon-e2e-live.smoke.test.ts:217<br/>new ClaudeProvider() — no selfHost"]
    Runner["DefaultStepRunner:540-548<br/>renderSkillInvocation(build) → '/pipeline'"]
    Env["ClaudeProvider.buildEnv:738-745<br/>returns undefined when selfHost is unset<br/>⇒ child inherits the bare runner env"]
    CLI["claude --print --output-format json<br/>(prompt on stdin)"]
    Cat["$HOME/.claude/skills/<br/>NEVER POPULATED on the runner —<br/>live-daemon-e2e.yml installs only the CLI"]
    Result["{ num_turns: 0, is_error: false,<br/>result: 'Unknown command: /pipeline' }"]
    Classify["classifyCompletion:685-700<br/>success = exitCode === 0 ⇒ TRUE"]
    Review["build_review — real 3-turn dispatch, $0.3645<br/>'the diff is empty; completeness fails'"]

    Smoke --> Runner --> Env --> CLI
    CLI -. "resolves /pipeline against" .-> Cat
    CLI --> Result --> Classify
    Classify -- "reported as SUCCESS" --> Review
```

The failure is attributed nowhere along that path: the provider calls it a success,
the conductor advances, and the first thing that objects is a paid grader complaining
about an empty diff. `install-freshness.ts:1-15` already describes this exact class,
but its `bin/install --check` guard runs at `daemon-cli.ts:704` — the daemon *entry
point*, which this fixture bypasses by calling `runDaemon()` as a library.

## To-be

```mermaid
graph TD
    subgraph Fixture["Live E2E fixture (test/engine/daemon-e2e-live.smoke.test.ts)"]
        Skip["Existing skipIf gate<br/>(UNCHANGED — evaluated FIRST;<br/>uncredentialed advisory run still skips)"]
        Repo["Checkout under test<br/>(repoRoot/skills/ — the code being verified)"]
        Home["Provisioned provider home<br/>(REUSED — self-host/provider-home.ts,<br/>COPY semantics, no ambient reads)"]
        Pre["Step-command preflight<br/>(NEW — before any paid dispatch)"]
        Dispatch["DefaultStepRunner → ClaudeProvider<br/>(CHANGED — selfHost env supplied)"]

        Skip -- "only inside a selected case" --> Repo
        Repo -- "skills/ COPIED, never linked<br/>(no write-through into the checkout)" --> Home
        Home --> Pre
        Pre -- "all dispatchable commands resolve" --> Dispatch
        Pre -- "any missing ⇒ fail naming the command<br/>and the directory searched; ZERO spend" --> Stop["Test fails as<br/>ENVIRONMENT, not build"]
    end

    subgraph Registry["Command surface (already central)"]
        Map["skill-invocation.ts:11-54<br/>STEP_SKILL_INVOCATIONS<br/>(UNCHANGED — the enumeration source)"]
        Render["renderSkillInvocation:56-66<br/>(UNCHANGED — '/name' | '$name')"]
        Map --> Render
        Map -. "preflight enumerates every<br/>kind:'skill' entry a run can reach" .-> Pre
    end

    subgraph Provider["Provider boundary (src/execution/claude-provider.ts)"]
        Parse["parseJsonResult:429-467<br/>(CHANGED — retain the unresolved-command<br/>signal from the envelope it currently discards)"]
        Cls["classifyCompletion:685-700<br/>(CHANGED — an unresolved step command is<br/>NOT success, regardless of exit code)"]
        Flag["InvokeResult<br/>(CHANGED — one named failure reason,<br/>alongside authFailure / modelUnavailable)"]

        Parse --> Cls --> Flag
    end

    Dispatch --> Parse
    Flag -- "distinguishable from a genuine<br/>build regression" --> Out["Failure names the missing command;<br/>no paid grader needed to reach it"]

    subgraph CI[".github/workflows"]
        Live["live-daemon-e2e.yml<br/>(UNCHANGED shape — still workflow_dispatch<br/>+ workflow_call, still absent from ci-gate)"]
        Rel["release.yml gate (#1259 / PR #1310)<br/>(UNBLOCKED — fail-closed call becomes safe)"]
        Live --> Rel
    end

    Fixture --> Live
```

## Component responsibilities

| Component | Status | Responsibility |
|---|---|---|
| `test/engine/daemon-e2e-live.smoke.test.ts` | CHANGED | Owns its provider environment. Provisions a home from the checkout under test, preflights, tears down on both branches. |
| `src/engine/self-host/provider-home.ts` | REUSED | Builds an isolated provider home from a root's `skills/` by **copying**, prunes operator-only skills, fails closed on a missing `skills/`, reads no operator state, and tears down. Provider-neutral, so the reserved Codex leg is one entry plus a credential. |
| `src/engine/self-host/sandbox-build-env.ts` | NOT USED | Deliberately not the primitive here: it symlinks (a write-through path into the checkout) and reads the operator's `~/.claude.json`. It remains correct for genuine self-host builds. |
| `src/engine/skill-invocation.ts` | UNCHANGED | The enumeration source for registry-rendered commands. The preflight reads it; nothing hardcodes `pipeline`. Config-declared custom and parallel-branch steps dispatch outside it (`step-runners.ts:546-548`) and are a stated non-covered surface. |
| `src/execution/claude-provider.ts` | CHANGED | Stops reporting an unresolved step command as success. Narrow classification only — no new flags, no argv change. |
| `.github/workflows/live-daemon-e2e.yml` | UNCHANGED | Trigger shape, matrix, advisory/gate modes and `ci-gate` absence are all preserved (`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`). |
| `src/engine/install-freshness.ts` | UNCHANGED | Keeps guarding the operator's global catalog at daemon entry. The new checks cover the paths it structurally cannot see. |

## Boundaries this work does not cross

- **No new assertion on agent behavior.** `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
  still governs: terminal state, committed artifacts, token cap. Turn counts stay
  diagnostic, never an outcome assertion.
- **No global mutation on the runner or the operator's machine.** Nothing runs
  `bin/install` in CI and nothing writes `~/.claude`.
- **No write of any kind into the checkout under test.** Skills are copied, never linked,
  so a concurrent self-host build's live-boundary fingerprint cannot be disturbed.
- **No change to the advisory/gate skip semantics.** The existing credential and CLI skip
  predicate is evaluated first and keeps its meaning; provisioning runs only inside a
  selected case.
- **No workflow trigger change.** The tier stays out of `ci-gate` and off the
  pull-request path.
