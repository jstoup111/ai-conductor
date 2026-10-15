---
slug: namespace-harness-skill-and-agent-names-so-they-ca
spec_hash: 42586cb9ebb5fca8fbe3e0b1743b88784b38cf7573d8a789d1f0dc0ffad50a5c
pr: https://github.com/jstoup111/ai-conductor/pull/3244
shipped: 2026-10-15
engine_version: 20261015T004522Z-65702d1bcf72
findings:
  - gate: architecture_review_as_built
    finding: "as-built:d65d8a1a-07bd-498e-b2d9-20806117a940:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-ac-prefixed-skill-names decision 2"
    outcome: remediated
    summary: "Verified, 99% confidence: step-runners.ts:1893, :1993 and :1994 regenerate invocations without the resolved frontmatter name. provider-execution.ts:900 and :912-915 apply these candidate overrides over the resolved prompt, affecting ordinary steps and one-shot gates, complexity and rebase. Additionally, step-runners.ts:4814 passes the bare rubric name into the host-visible unresolved-skill diagnostic rendered at build-review-domain.ts:946. Preserve resolved names at all four sites."
  - gate: architecture_review_as_built
    finding: "as-built:d65d8a1a-07bd-498e-b2d9-20806117a940:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-ac-prefixed-skill-names decision 3"
    outcome: remediated
    summary: "Source-verified, 98% confidence: bin/install:139-140 captures raw YAML text, while skill-names.ts:21-25 parses YAML. Valid declarations such as name: \"ac-plan\" or name: ac-plan # comment therefore produce installer catalog keys different from engine invocation names. The installer reader must resolve the same frontmatter value."
  - gate: architecture_review_as_built
    finding: "as-built:d65d8a1a-07bd-498e-b2d9-20806117a940:3"
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "Verified, 99% confidence: materially changed export sandboxLinkTargets at src/conductor/src/engine/self-host/sandbox-build-env.ts:414 has no production caller. Repository-wide references contain only its definition and test import/call. Task 8 must connect this behavior to a production consumer."
  - gate: architecture_review_as_built
    finding: "as-built:46f5d48b-6d21-4338-b014-ec43402caa83:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-ac-prefixed-skill-names decision 2"
    outcome: remediated
    summary: "Source-verified, 99% confidence: R1 remains incomplete. At src/conductor/src/engine/step-runners.ts:1697 and :1739, resolvedSkillName is passed as argument nine, which the signature at :1831 defines as invocationKind; resolvedSkillName belongs in argument ten (:1832). Consequently, ordinary skill names disable candidate-specific rendering at :1888, leaving fallback providers with the original provider's invocation syntax. Pass 'skill' before resolvedSkillName at both calls. The added test masks this by accepting the original prompt when optionsForCandidate is absent."
  - gate: architecture_review_as_built
    finding: "as-built:46f5d48b-6d21-4338-b014-ec43402caa83:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-ac-prefixed-skill-names decision 3"
    outcome: remediated
    summary: "Source-verified, 99% confidence: R3 remains incomplete. bin/install:144 and :149 recognize quoted scalars only when the raw value ends with a quote. Both name: \"ac-plan\" # comment and name: 'ac-plan' # comment enter :154-156, which strips the comment but retains quotation marks. Installer catalog keys therefore differ from the engine's YAML-parsed ac-plan at src/conductor/src/engine/skill-names.ts:21-25. Resolve quoted values with trailing comments consistently with YAML."
  - gate: architecture_review_as_built
    finding: "as-built:86ec9f6b-9880-49fd-8780-0f5fa987bd0b:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-ac-prefixed-skill-names decision 3"
    outcome: remediated
    summary: "Source-verified, 99% confidence: the R6 repair introduces an escaped-quote regression at bin/install:150. It compares the one-character substring from :149 against a single-quoted string containing two backslashes, so the escape branch never matches. Valid YAML such as name: \"ac-\\\"plan\" is consequently rejected at :171-173, while skill-names.ts:21-25 accepts it. This newly changed scanner was introduced in f5a3d75e1e, so the finding concerns code changed since the prior lap. R3 and R6 explicitly require escaped-double-quote handling."
---

## Cost
input: 2135216
output: 229042
cache_read: 33838971
cache_creation: 1529813
cost_usd: 36.3305
dispatches: 44
retries: 6
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2135052, output: 122688, cache_read: 28052352, cache_creation: 0, cost_usd: 20.8069, dispatches: 24, cost_unmetered: 0
  claude: input: 164, output: 106354, cache_read: 5786619, cache_creation: 1529813, cost_usd: 15.5236, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","d092d713-9eec-4bf9-8849-4fb11dc781d5","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 5
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 5, judged: 5
skip_reasons:
  disabled: 5
