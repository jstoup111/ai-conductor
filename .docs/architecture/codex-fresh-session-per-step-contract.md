# Components: Codex fresh-session-per-step contract (#903)

**Last updated:** 2026-07-27
**Scope:** The provider-session dispatch seam — `ProviderSessionStore`/`ProviderSessionScope`
(`provider-session.ts`), `runProviderInvocation` (`provider-execution.ts:368-400`), the
`LLMProvider` `InvokeOptions` contract (`llm-provider.ts:112-113`), the Codex adapter's argv
builder (`codex-provider.ts:495-516`), and the conductor's fresh-session-per-step reset
(`conductor.ts:3544-3560`) plus its stale-session recovery branch (`conductor.ts:3980-3997`).

## Current wiring (as built)

```mermaid
graph TD
    subgraph Conductor["conductor.ts — per-step loop"]
        RESET["resetSession(step.name)<br/>conductor.ts:3558<br/>#325 fresh session per step"]
        RETRY["retry loop (attempt 1..maxRetries)<br/>conductor.ts:3563+"]
        STALE["result.sessionExpired →<br/>resetSession() + attempt--<br/>conductor.ts:3980"]
    end

    subgraph Runner["step-runners.ts"]
        BEGIN["resetSession → sessionStore.beginStep(step)<br/>step-runners.ts:1109"]
        PROMPT["buildSystemPrompt(step, autonomous, retryReason)<br/>step-runners.ts:1819<br/>RETRY: prefix + FULL prompt (1901)"]
    end

    subgraph Store["provider-session.ts"]
        SCOPE["ProviderSessionScope per step"]
        MINT["create(): id = uuidv4()<br/>provider-session.ts:34"]
        PREP["prepare(): resume = session.created<br/>provider-session.ts:43-45"]
        MARK["markCreated(): created = true<br/>provider-session.ts:53"]
    end

    subgraph Exec["provider-execution.ts"]
        INVOKE["runProviderInvocation<br/>resume: forceFreshSession ? false : session.resume<br/>provider-execution.ts:397"]
        SELFHOST["forceFreshSession: selfHost !== undefined<br/>provider-execution.ts:546 (#1041 hotfix)"]
    end

    subgraph Adapters["execution/*-provider.ts"]
        CLAUDE["claude-provider<br/>--session-id &lt;uuid&gt; | --resume &lt;uuid&gt;<br/>real, functional"]
        CODEX["codex-provider buildArgs<br/>resume ? ['exec','resume',sessionId] : ['exec']<br/>codex-provider.ts:496-498"]
        EXPIRED["CODEX_SESSION_EXPIRED_RE<br/>codex-provider.ts:24 → sessionExpired (273)"]
    end

    RESET --> BEGIN --> SCOPE
    SCOPE --> MINT --> PREP --> INVOKE
    RETRY --> PROMPT --> INVOKE
    INVOKE --> CLAUDE
    INVOKE --> CODEX
    SELFHOST -.suppresses.-> INVOKE
    CODEX -->|"no rollout found"| EXPIRED --> STALE
    MARK -.after first invocation.-> PREP
```

### The defect this diagram encodes

`prepare()` returns `resume: session.created`, so **attempt 2+ within a step resumes**. For
Claude that works — `--session-id <uuid>` registers the id and `--resume <uuid>` finds it. For
Codex it cannot: `codex exec resume <id>` expects a Codex **rollout id** (uuidv7, minted by
Codex), while the harness supplies its own `uuidv4` (`provider-session.ts:34`), and `codex exec`
exposes no flag to pre-register a caller-supplied id. Every Codex resume therefore fails with
`no rollout found for thread id …`, is caught by the stdout regex at `codex-provider.ts:24`, and
round-trips through the conductor's stale-session branch — burning a real Codex invocation per
retry to learn something structurally knowable.

## Target wiring

```mermaid
graph TD
    subgraph Contract["llm-provider.ts — capability contract"]
        CAP["LLMProvider.supportsSessionResume: boolean<br/>NEW — declared by each adapter"]
    end

    subgraph Store2["provider-session.ts (unchanged)"]
        PREP2["prepare(): resume = session.created<br/>still the session-store's view"]
    end

    subgraph Exec2["provider-execution.ts — single suppression seam"]
        RESOLVE["resume = provider.supportsSessionResume<br/>&amp;&amp; !forceFreshSession<br/>&amp;&amp; session.resume<br/>NEW — capability wins, fail-closed"]
        DIAG["emit session_policy diagnostic once per step<br/>when capability suppresses a resume"]
    end

    subgraph Adapters2["adapters"]
        CLAUDE2["claude-provider<br/>supportsSessionResume = true<br/>behavior unchanged"]
        CODEX2["codex-provider<br/>supportsSessionResume = false<br/>buildArgs: 'exec resume' branch REMOVED<br/>argv is structurally unconstructable"]
    end

    subgraph Effect["observable effect"]
        FRESH["every Codex invocation = cold start<br/>step boundary AND within-step retry"]
        SELF["retry carries context via the prompt:<br/>'RETRY: &lt;reason&gt;' + FULL system prompt<br/>step-runners.ts:1901 — already self-contained"]
        NOEXP["sessionExpired can no longer originate<br/>from our own resume request"]
    end

    CAP --> RESOLVE
    PREP2 --> RESOLVE
    RESOLVE --> DIAG
    RESOLVE --> CLAUDE2
    RESOLVE --> CODEX2
    CODEX2 --> FRESH --> SELF
    CODEX2 --> NOEXP
```

## Component responsibilities after the change

| Component | Responsibility | Change |
|---|---|---|
| `LLMProvider` (`llm-provider.ts`) | Declares whether the provider can resume a harness-minted session id | **New** `supportsSessionResume` field |
| `ClaudeProvider` | Session create/resume via `--session-id` / `--resume` | Declares `true`; no behavior change |
| `CodexProvider` | One-shot `codex exec` dispatch only | Declares `false`; `exec resume` argv branch deleted |
| `runProviderInvocation` | The single place resume is decided | Capability gate ANDed in; emits a suppression diagnostic |
| `ProviderSessionStore` | Per-step scope + id minting for correlation/audit | Unchanged (the id stays useful as a log correlation key) |
| `conductor.ts` reset + stale branch | Step-boundary reset; stale-session recovery | Unchanged |

## Boundary with #1042

#1042 owns **where a Codex session could live** — self-host home provisioning, whether
`CODEX_HOME` under `/tmp` is acceptable, and whether provider session identity should be read
back from Codex instead of minted. This feature owns only **whether dispatch asks to resume at
all**, and answers "no, structurally." The two do not conflict: making resume unrequestable is a
precondition for #1042's decision, not a substitute for it. `forceFreshSession`
(`provider-execution.ts:376`, the #1041 hotfix) is deliberately left in place — it is
provider-agnostic and remains #1042's seam.
