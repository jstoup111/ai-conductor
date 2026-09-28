# Components: as-built review on an engine-owned input projection and typed verdict

**Last updated:** 2026-09-23
**Scope:** The `architecture_review_as_built` step (#2188). Today the reviewer gathers its own
evidence under a six-line `AS-BUILT CHECK POLICY` block and writes
`.pipeline/architecture-review-as-built.md`, which about eight engine sites re-parse with regexes
(verdict line, `Outcome delivered:` line, `## Blocking Findings` table, governing-clause grammar,
`## Recorded Findings` JSON block). This change moves both sides of the step onto engine-owned
contracts. The engine renders a bounded, versioned input projection. The step dispatches on the
#2429 `nativeSchema` seam. The engine validates the terminal structured result, stamps run
identity, persists the typed verdict as the sole authority, and renders the human-readable report
from it. Verdict vocabulary, routing, remediation admission, operator authority, and delivery
semantics are unchanged in meaning; only their input changes from scraped Markdown to the typed
verdict.

## Diagram

```mermaid
graph TD
    subgraph Sources["Feature inputs (worktree)"]
        DIFF["base...HEAD diff"]
        PLAN["active plan: task table + Done-when"]
        STORY["sealed story criteria"]
        ADR["APPROVED ADR decisions (parseAdrDecisions)"]
        PEND["kickback ledger: pendingAsBuiltRemediationFindings"]
        POL["as-built check policy (config)"]
    end

    subgraph Projection["As-built input projection (new, versioned)"]
        BUILD["build(sources, limits)"]
        LIM{"within limits?"}
        OMIT["diff over cap: explicit omission list,<br/>reviewer inspects on demand"]
        OVER["required structured input over cap / missing:<br/>named mechanical fault"]
        PV["projection vN (JSON)"]
    end

    subgraph Contract["As-built verdict contract (new, versioned)"]
        SCHEMA["JSON Schema: verdict · outcomeDelivered ·<br/>findings[class, reference, summary] · notes"]
        REFS["structural reference:<br/>adr-decision {stem, decision} or plan-task {taskId}"]
        PARSE["hand-written exact-key validator<br/>field-named diagnostics"]
    end

    subgraph Dispatch["Step runner one-shot skill path (#2429 seam)"]
        INV["skill invocation + projection prompt<br/>interactive = false"]
        CAP{"provider declares<br/>nativeOutputSchema?"}
        PROV["claude --json-schema · codex --output-schema"]
        SR["finalStructuredResult"]
    end

    subgraph Engine["Engine authority"]
        VAL["validate + resolve references<br/>(ADR approved + decision exists; plan task exists)"]
        FAULT["no-retry mechanical-fault halt (D7.1):<br/>native-schema-unsupported · input-over-limit"]
        RETRY["structured-output fault: structured-result-missing ·<br/>invalid-structured-result → scored absent,<br/>rerun within retry budget → needs-human on exhaustion"]
        STAMP["stamp run identity (adr-2026-08-25 ship-tail)"]
        STORE["typed verdict artifact (sole authority)"]
        MD["rendered report .md (derived, never read back)"]
        READER["single typed-verdict reader"]
    end

    subgraph Consumers["Verdict consumers (rewired, semantics unchanged)"]
        GATE["completion gate + code stamp"]
        GROUP["validation-group join"]
        SERIAL["serial halt / kickback"]
        REM["remediation admission (planRemediation)"]
        REC["recorded-findings projection"]
        SHIP["shipped record / finish publication"]
        REKICK["rebase preservation · rekick · stale sweep · retry classify"]
        FENCE["pre-finish fence (computeAndWriteVerdict)"]
        REWIND["operator rewind + rollback"]
    end

    subgraph Skill["skills/architecture-review/SKILL.md §12 (as-built)"]
        JUDGE["judgement guidance only: reachability,<br/>plan-gap, ADR compliance, drift semantics"]
    end

    AUDIT["provider skill-contract audit:<br/>forbid input recipes + output-format prose in §12"]

    DIFF --> BUILD
    PLAN --> BUILD
    STORY --> BUILD
    ADR --> BUILD
    PEND --> BUILD
    POL --> BUILD
    BUILD --> LIM
    LIM -- diff over cap --> OMIT
    LIM -- structured over cap --> OVER
    LIM -- yes --> PV
    OMIT --> PV
    OVER --> FAULT
    PV --> INV
    SCHEMA --> INV
    INV --> CAP
    CAP -- no --> FAULT
    CAP -- yes --> PROV
    PROV --> SR
    SR --> VAL
    SR -- missing --> RETRY
    RETRY -- budget remains --> INV
    PARSE --> VAL
    REFS --> VAL
    VAL -- rejected --> RETRY
    VAL -- accepted --> STAMP
    STAMP --> STORE
    STORE --> MD
    STORE --> READER
    READER --> GATE
    READER --> GROUP
    READER --> SERIAL
    READER --> REM
    READER --> REC
    READER --> SHIP
    READER --> REKICK
    READER --> FENCE
    READER --> REWIND
    REC -- engine writes back --> STORE
    JUDGE -. invoked as the review role .-> INV
    AUDIT -. audits .-> JUDGE
```

## Sequence: one as-built dispatch

```mermaid
sequenceDiagram
    participant CD as Conductor
    participant PB as Projection builder
    participant RN as Step runner
    participant PX as Provider execution
    participant PR as Provider (Claude or Codex)
    participant VD as Verdict validator
    participant AU as Typed verdict store
    participant CN as Consumers

    CD->>PB: build(feature worktree, limits)
    alt required structured input missing or over limit
        PB-->>CD: mechanical fault naming dimension, size, limit
    else within limits (diff omissions listed)
        PB-->>CD: projection vN
        CD->>RN: run as-built with projection + nativeSchema
        RN->>PX: invoke skill one-shot, interactive false
        alt candidate lacks native schema capability
            PX-->>RN: native-schema-unsupported
            RN-->>CD: mechanical fault
        else capable
            PX->>PR: skill command + projection + schema
            PR-->>PX: terminal structured result
            PX-->>RN: finalStructuredResult or structuredResultFailure
            RN->>VD: validate(result)
        alt missing or invalid structured result
            VD-->>CD: scored absent; rerun within retry budget
            CD-->>CN: needs-human only on exhaustion
            else valid
                VD->>AU: persist verdict stamped with run identity
                AU->>AU: render report .md from typed verdict
                AU-->>CN: typed verdict via single reader
            end
        end
    end
```

## Legend

- **As-built input projection** — new engine module. Rendered by the dispatcher, versioned, and
  bounded per dimension. Diff content past its cap degrades to an explicit list of omitted files
  that the reviewer may inspect on demand; a required structured dimension (plan tasks and
  Done-when, sealed story criteria, approved ADR decisions) that is missing or over its limit is a
  named mechanical fault, never silent truncation (precedent: adr-2026-09-07 D7). Prior findings
  are only those already available (`pendingAsBuiltRemediationFindings`); new finding-history
  inputs belong to #2440.
- **As-built verdict contract** — new engine module. The JSON Schema handed to the provider
  natively and a hand-written exact-key validator (no schema library; precedent:
  `prd-widening-contract.ts`). Verdict vocabulary stays `APPROVED | APPROVED WITH DRIFT NOTES |
  PLAN_GAP | BLOCKED`; finding class stays `REMEDIABLE | DESIGN`. References are structural
  objects, replacing the governing-clause text grammar; resolution through `parseAdrDecisions` and
  plan task bodies is retained.
- **Step runner one-shot skill path** — the path #2429 added for `remediate`
  (`executeProviderAwareSkillOneShot`), extended to this step. `interactive` is forced false
  because the Claude adapter refuses `nativeSchema` interactively.
- **Typed verdict store** — the authority every consumer reads through one reader. The `.md`
  report is rendered from it and is never parsed. The engine, not the reviewer, is the writer, so
  the dispatch-write handshake and the mandatory-overwrite instruction in the skill no longer
  apply. Recorded-findings projection updates the typed store and re-renders.
- **Mechanical-fault lanes** — none is ever a substantive verdict. Unsupported capability and
  over-limit input (D7.1 input faults) halt with no retry. A missing or invalid structured result
  scores absent and reruns within the step's retry budget, halting needs-human only on exhaustion.
- **Dotted edges** — the skill invocation and the audit are not on the data path. The audit is
  scoped to the as-built section because the skill file also serves the pre-stories and
  drift-check modes.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-23 | Initial generation | Spec for #2188 — as-built bounded inputs and typed verdicts |
| 2026-09-23 | Add the pre-finish fence and operator rewind as typed-verdict consumers | Plan update: consumers found by the repo-wide ADR sweep (architecture review A-8) |
