# ADR: Codex model policy ids are per-tier floors upgraded from the CLI catalog

**Date:** 2026-10-25
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE session

## Context

The built-in Codex model policy (`provider-model-policy-defaults.ts`) pins `gpt-5.6-luna`,
`gpt-5.6-terra`, and `gpt-5.6-sol` for every step default, tier override, escalation rung, and
fallback rung. The Codex CLI moves on independently. On 2026-10-25 `codex debug models` (codex-cli
0.160.1) listed, in priority order, `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, then
the three `gpt-5.6-*` models (plus hidden, non-tiered entries). The operator's interactive Codex
already defaults to `gpt-6.1-sol`, while every daemon Codex step still ran a 5.6 model.

The reactive fallback ladder (adr-2026-07-03-reactive-model-fallback-ladder) only steps down
within the configured ids on `modelUnavailable`, so it never upgrades, and once the 5.6 models are
retired every rung fails and the step halts. The Claude policy has no such problem: it names
version-free aliases (`fable`, `opus`, `sonnet`, `haiku`) that the Claude CLI resolves itself. The
one Claude exception is the self-host token-liveness probe, which pins
`claude-haiku-4-5-20251001`.

adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D13 already established a once-per-boot
catalog listing (`pi --list-models`) on provider-dispatching entry points (D8), through an injected
runner guarded by `assertRealExecAllowed`. Declaring the same `modelCatalog` member on Codex would
also turn on two consumers the operator scoped out: boot-time rejection of configured ids absent
from the listing (D13) and monitor membership checks (adr-2026-10-06 D5).

`architecture-review-2026-09-10-support-astra-in-the-daemon` kept `gpt-6-astra` opt-in and out of
every automatic escalation order. On 2026-10-25 the operator chose to make it the top Codex
escalation rung while keeping it out of default step models and the default fallback ladder; that
review and its PRD carry amendment notes.

Policy readers that never probe — monitor guided-session defaults, `generate-model-table`, and
`rate-card refresh` (a D8 non-dispatching subcommand) — read the static policy directly.

## Options Considered

### Option A: Tier names in the policy, resolved at boot
- **Pros:** The policy states intent ("sol") with no version.
- **Cons:** Every policy reader that skips resolution would hand a bare tier name to `codex
  --model` and fail. Non-dispatching readers cannot probe under D8.

### Option B: Pinned ids as per-tier floors, upgraded at dispatching boot
- **Pros:** Readers that skip resolution keep today's ids, so nothing regresses. Dispatching
  processes run the newest same-tier model. No version is ever downgraded.
- **Cons:** The floor ids still appear in source and still need an occasional bump once a floor
  model is retired, although the upgrade path normally hides that.

### Option C: Read `$CODEX_HOME/models_cache.json`
- **Pros:** No subprocess.
- **Cons:** Private file format; a self-host provider home may lack it or hold a stale copy.

### Option D: Keep pins and alarm on drift
- **Pros:** Smallest and fully reproducible.
- **Cons:** Still version-pinned, which the operator rejected.

## Decision

**Option B.**

1. **Floors.** The Codex policy keeps concrete ids. An id that parses as
   `gpt-«version»-«tier»`, where «version» is dot-separated non-negative integers and «tier» is
   one of `luna`, `terra`, `sol`, `astra`, is a floor. Any other id is opaque and is never
   rewritten. Codex's escalation order becomes `gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol →
   gpt-6-astra`; its fallback ladder stays `gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna`.
2. **Tier-only catalog member.** The Codex descriptor declares a new tier-catalog member, separate
   from `modelCatalog`, with argv `debug models` and a parser that returns the slugs whose
   `visibility` is `list` and whose `supported_in_api` is true, or `unparseable`. Declaring it turns
   on no configured-id validation and no monitor membership check.
3. **Resolution rule.** A floor resolves to the listed slug of the same tier with the highest
   version, compared numerically segment by segment with missing segments treated as 0, only when
   that version is strictly greater than the floor's. Otherwise the floor stands. A tier is never
   substituted for another, so terra stays `gpt-5.6-terra` until a newer terra is listed.
4. **Where it runs.** Each provider-dispatching boot path of adr-2026-09-24 D8 — inline `conduct`
   runs (`index.ts`), daemon boot (`daemon-cli.ts`), and per-feature executor children
   (`executor-child-runtime.ts`) — runs the tier probe once after D3 discovery reports Codex
   installed, with the same injected-runner, `assertRealExecAllowed`, and 5-second timeout shape
   as the Pi probe. A timeout, non-zero exit, or unparseable listing logs one warning naming the
   failure and leaves every floor in force. A probe failure never fails boot.
5. **Process policy registry.** The resolved floor-to-id map materializes a frozen Codex policy —
   step models, tier overrides, escalation order, and fallback ladder — installed once per
   process. `resolveProviderModelPolicy` returns it for Codex when installed, then applies
   `llm_providers.codex` overrides on top exactly as today. Operator-configured ids stay opaque and
   keep their precedence. Readers that do not go through that lookup, and processes that never
   probe, see the floors. The registry lives for the process, like the `ModelAvailability` cache,
   and a restart re-probes.
6. **Observation on the existing spine.** No new event type, file, or sidecar is added. The
   resolved id is the `model` that existing dispatch, retry, and cost events already carry, and
   the existing downgrade warning reports resolved ids.
7. **Unpriced resolved ids.** After materialization, each resolved id that differs from its floor
   and has no entry in the committed rate card logs one warning naming the id and the remedy
   `ai-conductor rate-card refresh --model «id»`. Cost attribution continues to count such
   dispatches as unmetered.
8. **Claude liveness probe.** The self-host token-liveness probe passes `--model haiku` instead of
   `claude-haiku-4-5-20251001`.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `codex debug models` prints JSON `{ models: [{ slug, visibility, supported_in_api, ... }] }` and exits 0 | verified | 95% | yes | The parser returns unparseable, so floors stay in force with a warning | n/a |
| A2 | A higher numeric version within a tier is a newer, preferred model (6.1 > 6 > 5.6) | inferred | 90% | yes | An older model could be selected over a newer one | APPROVED by operator 2026-10-25 |
| A3 | The listing reflects models the account can use | inferred | 75% | no | A listed but unentitled model fails with modelUnavailable and the reactive ladder walks down resolved rungs | n/a |
| A4 | The probe works in the dispatching process's own environment, outside self-host provider-home isolation | inferred | 70% | no | Floors stay in force with a warning, which is today's behavior | n/a |
| A5 | The Claude CLI accepts `--model haiku` with `-p` | verified | 95% | yes | Liveness probe fails; the policy already dispatches `memory` and `worktree` on `haiku` | n/a |

## Consequences

### Positive
- Daemon Codex steps run `gpt-6.1-sol` and `gpt-6-luna` today and pick up later same-tier
  releases with no code change.
- A retired floor no longer strands a step while a newer same-tier model is listed.
- Escalation can reach astra for hard retries.

### Negative
- Which model runs now depends on the CLI's listing at process start, so two processes started
  on either side of a Codex release can run different models. The dispatch events record which.
- Newly resolved models are unpriced until the operator refreshes the rate card, and their costs
  count as unmetered meanwhile.
- Escalating to astra costs about 2.5 times sol per token on the committed card.
- `codex debug models` is a debug subcommand whose output may change. The floors contain that
  risk, but a format change silently returns all steps to floors apart from the warning.

### Follow-up Actions
- [ ] Refresh the rate card for `gpt-6.1-sol`, `gpt-6-sol`, and `gpt-6-luna` once the upstream
      source prices them.
