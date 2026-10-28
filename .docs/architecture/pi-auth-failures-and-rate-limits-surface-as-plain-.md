# Components: Pi auth, rate-limit, and usage-exhaustion recovery (#2718)

**Last updated:** 2026-10-28
**Scope:** Proposed classification of Pi authentication failures, rate limits, and usage
exhaustion in the Pi adapter, and the Pi-owned credential park that an auth failure enters.
Claude and Codex classification and parking are unchanged.

Pi reports a failed provider request in one of two channels, verified against Pi 1.0.0:

- **Error stop, exit 0.** The terminal assistant `message_end` carries `stopReason: "error"` and an
  `errorMessage`. An HTTP rejection renders as `<status>: <body>` for OpenAI-compatible APIs and
  `<status> <body>` for the Anthropic API. Pi retries a 429 three times before this stop.
- **Thrown, exit 1.** A failure before the request, such as no configured credential, prints Pi's
  own message on stderr and emits no assistant message.

Today `parkOnAuthFailure` (`engine/conductor.ts`) has two recovery shapes. A provider that declares
`readiness` (Codex) polls a readiness probe. Every other result falls through to the Claude
branches, which poll `~/.claude/.credentials.json` or a daemon build token. A Pi `authFailure`
would therefore wait on Claude's credentials. The new branch sits before that fall-through and is
selected by a catalog declaration, never by a provider-id comparison.

## Diagram

```mermaid
graph TD
    subgraph PiRun["Pi subprocess - pi -p --no-session --mode json"]
        STOP["terminal assistant message_end: stopReason error, errorMessage"]
        ERR["stderr on exit 1: Pi-owned pre-request message"]
    end

    subgraph Adapter["PiProvider.invoke - execution/pi-provider.ts"]
        PARSE["parsePiJsonl - terminal stopReason and errorMessage, unchanged"]
        CLS["classifyPiFailure - new, line-anchored verified signatures"]
        RES["InvokeResult: rateLimited, usageExhausted, waitSeconds, authFailure, authentication"]
    end

    subgraph Contract["Provider contract"]
        AUTHREC["authentication record - widened with a credential-file member for Pi"]
        CAT["Pi catalog descriptor - declares credentialFileRecovery: auth.json in the live Pi home"]
    end

    subgraph Engine["Engine recovery - unchanged paths except the park branch"]
        PE["executeProviderCandidates - authFailure and rateLimited stop the candidate walk"]
        SERIAL["serial loop - rateLimited waits, usageExhausted suppresses the provider"]
        GROUP["concurrent group JOIN - authFailure no-verdict carries authentication"]
        PARK["parkOnAuthFailure"]
        RDY["readiness branch - Codex, unchanged"]
        PIPARK["credential-file branch - new: wait for auth.json to change, then resume"]
        CLAUDE["Claude credential branches - unchanged, no longer reached by Pi"]
        AVAIL["providerAvailability.suppress - other dispatches in the window skip Pi, their ladder advances"]
        HALT["needs-human HALT naming the Pi credentials file, no provider output"]
    end

    PIHOME[("live Pi home auth.json - PI_CODING_AGENT_DIR or ~/.pi/agent")]

    STOP --> PARSE
    ERR --> CLS
    PARSE --> CLS
    CLS --> RES
    RES --> AUTHREC
    RES --> PE
    PE --> SERIAL
    PE --> GROUP
    SERIAL -->|"authFailure"| PARK
    GROUP -->|"authFailure"| PARK
    SERIAL -->|"usageExhausted"| AVAIL
    PARK -->|"descriptor declares readiness"| RDY
    PARK -->|"descriptor declares credentialFileRecovery"| PIPARK
    PARK -.->|"neither declared"| CLAUDE
    CAT --> PIPARK
    PIPARK -->|"poll mtime and parse"| PIHOME
    PIPARK -->|"changed - resume, budget intact"| SERIAL
    PIPARK -->|"timeout"| HALT
```

## Notes

- The signatures and their captures are recorded in
  `adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output`.
- Usage exhaustion reuses the existing serial-loop path. `usageExhausted` with an
  `actualProvider` suppresses that provider in `providerAvailability`. Every other candidate walk
  in that window refuses Pi with `provider-suppressed` and moves on, while the dispatch that saw the
  exhaustion waits for the deadline, as it does for Codex.
- The self-host throwaway Pi home is provisioned per candidate dispatch from the live home (D25 of
  `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`). After the park resumes, the next
  dispatch therefore picks up the refreshed credential.
