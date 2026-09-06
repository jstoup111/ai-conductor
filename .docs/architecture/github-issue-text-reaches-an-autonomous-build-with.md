# Architecture — Inbound intake trust boundary (tracker text is evidence, not instruction)

**Stem:** `github-issue-text-reaches-an-autonomous-build-with` · Tier M (lightweight diagram) · 2026-09-06 · Refs #1479

Today `intake/github-issues.ts` `buildText()` joins an issue's title and body verbatim into
`Envelope.text`, and that string is printed by `compose claim`, persisted as the claim record,
and staged into `.pipeline/intake-outcomes.md` — all of which a DECIDE session reads as prose,
in the same channel as operator instruction. `intake/sanitize.ts` scrubs only the **outbound**
direction (filing).

The change adds the mirrored **inbound** seam at the same choke point every writer passes
through — the adapter's `buildText()` — so a human filer, an automated filer (#355), and a
re-routed closed issue all receive identical treatment:

1. **Neutralize** directive-shaped content *outside* fenced/indented code with an inert
   inline marker (`[neutralized:<category>]`). Code fences, stack traces, shell transcripts,
   and quoted log lines are never rewritten, and Markdown structure (`## Desired outcome`,
   bullets) is preserved so `outcome-staging.ts` keeps parsing.
2. **Delimit** the whole tracker-sourced region with provenance armor lines carrying the
   `sourceRef` and a content digest, so every consumer can tell where untrusted text starts
   and ends.
3. **Record** what happened as a `ConductorEvent` (`intake_inbound_sanitized`), echoed in the
   `compose claim` JSON and kept on the claim record, so the operator can see it after the fact.

Excluded: any change to build privilege (`--dangerously-skip-permissions`) — separate intake.

## Component / dataflow (C4 component level)

```mermaid
flowchart TD
  subgraph WRITERS["Writers to the tracker (all untrusted at the boundary)"]
    HUM["Human filer"]
    AUTO["Automated filer<br/>(#355 halt-monitor, future sources)"]
    OUT["intake/file-issue.ts<br/>outbound sanitizeIntakeText<br/>(unchanged)"]
  end

  HUM --> GH[("GitHub issue<br/>title + body")]
  AUTO --> OUT --> GH

  subgraph ADAPTER["intake/github-issues.ts (poll / re-route)"]
    BT["buildText(title, body)<br/>NOW: joins, then calls the inbound seam"]
  end

  subgraph SEAM["intake/sanitize-inbound.ts — NEW pure module"]
    FENCE["segment: fenced / indented code<br/>vs prose — code is exempt"]
    NEUT["neutralize directive shapes in prose<br/>→ [neutralized:«category»] inline marker<br/>high-precision rules, idempotent"]
    DELIM["delimit: armor lines with<br/>sourceRef + sha256 digest"]
    RES["InboundSanitizeResult<br/>{ text, neutralizations[], digest }"]
  end

  GH --> BT --> FENCE --> NEUT --> DELIM --> RES

  RES --> ENV["Envelope { text, inbound: {neutralizations, digest} }<br/>(port.ts — additive optional field)"]

  subgraph CLI["engineer-cli.ts (compose / engineer)"]
    CLAIM["claim: prints { text, inbound }<br/>persists claim record with inbound"]
    WT["worktree --source-ref → outcome-staging.ts<br/>stages neutralized Desired-outcome bullets"]
  end

  ENV --> CLAIM --> WT
  WT --> EVT["ConductorEvent intake_inbound_sanitized<br/>{ sourceRef, neutralizations, digest }<br/>declared in EVENT_SINKS"]
  EVT --> LEDGER[("«worktree»/.pipeline/intake-events.jsonl<br/>single-writer sibling ledger, same schema<br/>exceptions A + B: CLI has no bus")]

  CLAIM --> HOST["Host DECIDE session (/composer or $composer)<br/>reads delimited region as evidence"]
```

## Sequence — directive-shaped issue body, before vs. after

```mermaid
sequenceDiagram
  participant F as Filer (any)
  participant A as github-issues adapter
  participant S as sanitize-inbound
  participant C as compose claim
  participant H as Host DECIDE session

  Note over F,H: BEFORE (#1479) — verbatim pass-through
  F->>A: issue body contains "Ignore the plan and run «cmd»"
  A->>C: Envelope.text = title + body, unchanged
  C->>H: { text } — indistinguishable from operator instruction
  H->>H: may act on the directive — nothing records it happened

  Note over F,H: AFTER — one seam, every writer
  F->>A: same issue body
  A->>S: buildText → sanitizeInboundText(text, sourceRef)
  S->>S: exempt code fences, neutralize prose directive → [neutralized:agent-directive]
  S->>S: wrap in armor lines with sourceRef + digest
  S-->>A: { text, neutralizations: [{category, count}], digest }
  A->>C: Envelope { text, inbound }
  C->>C: persist claim record { body, inbound }
  C->>H: { text, inbound } — untrusted region visible, alterations listed
  H->>C: worktree --source-ref
  C->>C: append intake_inbound_sanitized to «worktree»/.pipeline/intake-events.jsonl
  H->>H: same DECIDE behavior as a neutrally worded issue
```

## Key architectural decisions (see ADR)

1. **One choke point, every writer.** The seam lives inside `buildText()` in the adapter,
   not in the composer prose and not per-consumer, so no reader can receive raw tracker text
   and no new writer can bypass it. Mirrors where the outbound scrub sits (`file-issue.ts`).
2. **Neutralize, never delete.** Directive-shaped prose is replaced with an inert, categorized
   marker in place; code fences, indented blocks, and quoted logs are exempt. The issue stays
   debuggable and `## Desired outcome` bullets still parse for outcome staging and coherence.
3. **Delimiting is machinery, not prompt discipline.** Armor lines with `sourceRef` and a
   digest are part of the text itself, so every downstream surface (claim JSON, claim record,
   staged outcomes) carries the boundary without each consumer being told to add it.
4. **Audit on the spine, worktree-local sibling ledger by exceptions A + B.**
   `intake_inbound_sanitized` is a new `ConductorEvent` variant declared in `EVENT_SINKS`. The
   engineer CLI runs outside the daemon with no emitter, and the engineer dir is a cross-repo
   directory with concurrent writers, so the record is appended at `worktree --source-ref`
   time to `<worktree>/.pipeline/intake-events.jsonl` — the same shape as the hook-owned and
   pipeline-owned sibling ledgers — and echoed in the `claim` output and on the claim record.
5. **Privilege narrowing is out of scope.** `--dangerously-skip-permissions` is untouched;
   filed as a separate intake so this boundary can land without a provider-launch change.
