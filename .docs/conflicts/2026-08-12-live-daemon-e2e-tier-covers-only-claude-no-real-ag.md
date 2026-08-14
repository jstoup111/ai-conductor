# Conflict Check: Live daemon E2E tier covers only Claude — no real-agent Codex signal

**Date:** 2026-08-12
**Feature:** live-daemon-e2e-tier-covers-only-claude-no-real-ag (jstoup111/ai-conductor#1264)
**Tier:** M · **Track:** technical
**Stories scanned:** `.docs/stories/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md`
(stories 1–7), plus every other file in `.docs/stories/` for cross-feature interaction
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:82`)
**Result:** PASS after resolution — 1 blocking conflict found and resolved, 1 degrading
conflict found and resolved, 0 conflicts remaining

## ADR corpus selection (repo_wide)

**Examined** — approved ADRs whose subject overlaps these stories:

| ADR filename stem | Subject overlap |
|---|---|
| `adr-2026-08-12-per-provider-live-smoke-legs` | change set — leg shape, capability dimension, gate enforcement |
| `adr-2026-08-12-live-provider-coverage-from-plugin-registry` | change set — coverage guard |
| `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` | capability model, advisory/gate semantics |
| `adr-2026-08-04-classify-before-spend-release-smoke-gate` | the release gate that consumes the runner |
| `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` | the workflow and its `require_credentials` contract |
| `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` | what the live tier may assert |
| `adr-2026-08-04-live-tier-provisions-its-own-provider-home` | provisioned home, copy-never-link, teardown |
| `adr-2026-08-04-unresolved-step-command-fails-by-name` | step-command preflight before spend |
| `adr-2026-07-29-codex-readiness-probe-failure-disposition` | Codex readiness states (Story 1 negatives) |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision` | provider preparation and spawn permits |
| `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` | symmetric self-host isolation |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | `$name` versus `/name` command rendering |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` | per-provider dispatch scoping |
| `adr-2026-08-09-worktree-local-provider-scratch` | per-run provider scratch isolation |
| `adr-2026-08-07-worktree-removal-coverage-guard` | precedent for a structural coverage guard |

**Narrowed out** — approved but no subject overlap with these stories: the memory-provider ADRs,
`adr-014-otel-observability-exporter`, the release-PR and changelog ADRs, the rebase and
finish-publication ADRs, the plan-scope-containment ADRs, `adr-2026-07-22-coherence-waiver-and-duplicate-claim`,
`adr-2026-07-21-s-tier-pipeline-knobs`, `adr-2026-07-30-pinned-remote-theme-for-pages-navigation`,
and the daemon-restart/engine-store ADRs.

**Excluded as unambiguously fully superseded:** `adr-2026-08-04-smoke-capability-declaration-and-single-entry-point`
(its capability model is restated in full by its successor, which is examined above),
`adr-2026-07-23-built-in-provider-model-policies`, `adr-2026-07-24-provider-aware-step-execution`,
`adr-2026-07-25-codex-unattended-readiness-and-bounded-execution`,
`adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`,
`adr-2026-07-25-provider-neutral-safety-authority`,
`adr-2026-07-26-codex-auth-evidence-and-recovery-backoff`.

**Retained despite partial supersession:** `adr-2026-07-12-wiring-check-gate` — partially
superseded, and its gate has since been removed, so it imposes no requirement on these stories.
Retained in the corpus per the partial-supersession rule; compared and found non-conflicting.

---

## Conflict 1: The shared body cannot be provider-agnostic and also carry a Codex-only auth assertion

**Stories involved:** Story 1 (A real Codex agent drives the committed fixture to a successful
terminal state) vs Story 2 (Both legs run one shared body, so neither can drift from the other)
**Files:** `.docs/stories/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md` (both)
**Type:** oscillating
**Severity:** blocking

**Description:**

Both directions of the oscillation heuristic answer "no".

*If Story 2 is fully satisfied*, the shared body is provider-agnostic ("the leg supplies only
that descriptor and adds no provider-specific assertion logic"), a provider-specific branch inside
the shared body fails a structural check, and the Claude leg's assertions are "identical to those
it asserted before the extraction." Story 1's requirement that the Codex leg assert its resolved
authentication source then has nowhere to live: not in the shared body (provider-specific branch),
not in the leg (leg-local assertion logic), and not applied uniformly to Claude either (that would
add an assertion Claude did not previously make, breaking "identical"). **Story 1 does not hold.**

*If Story 1 is fully satisfied* by asserting the Codex auth source, that assertion is either a
provider name test inside the shared body — failing Story 2's structural check — or leg-local
logic, failing Story 2's "adds no provider-specific assertion logic". **Story 2 does not hold.**

This is the costly shape: each story reads as reasonable alone, and the collision would only
surface during BUILD as unexplained rework — add the assertion, the structural check kicks it
back; remove it, the auth-source requirement kicks it back.

**Root cause:** story-phrasing underspecification, not upstream design.
`adr-2026-08-12-per-provider-live-smoke-legs` already resolves it in principle — the shared body is
"parameterized by a provider descriptor" and takes its differences from that descriptor — but the
stories did not carry the descriptor through to the assertion, and Story 2's "identical" phrasing
forbade a strengthening the ADR never forbade. Resolved in `stories`, not kicked back.

**Resolution Options:**
1. The descriptor declares each provider's expected authentication source; the shared body asserts
   it once, uniformly, taking the expected value from the descriptor. Story 2's preservation clause
   is restated as "no assertion weakened, removed, or made conditional", explicitly permitting a
   uniform descriptor-derived strengthening.
2. The descriptor carries an optional per-provider assertion callback. More flexible, but it
   reintroduces exactly the per-leg divergence Story 2 exists to prevent — the callback becomes the
   place two legs drift apart.
3. Drop Story 1's auth-source assertion and rely on the run succeeding as implicit proof.

**Recommendation:** Option 1. Option 3 is unsafe on evidence: `CodexProvider` resolves
authentication in its constructor (`codex-provider.ts:169`), so a leg that constructs before
`CODEX_API_KEY` is present falls back to `cached-login` — and on a runner with no
`~/.codex/auth.json`, the failure surfaces as an unrelated file error rather than as the ordering
mistake it is. Option 2 reopens the drift Story 2 was written to close. Option 1 additionally makes
the Claude leg's own auth source checkable, which it is not today.

**Applied:** Option 1. Story 2's happy path now reads "no observable assertion it made before the
extraction … is weakened, removed, or made conditional. A *uniform* assertion added for every
provider and derived from the descriptor is a permitted strengthening; a provider-specific
assertion is not", plus a new criterion requiring the assertion be written once and take its
expected value from the descriptor. Story 1's corresponding negative path now names the descriptor
as the source of the expected value and states the assertion is the uniform Story 2 one.

---

## Conflict 2: Per-leg tolerance of an absent credential versus the aggregate credentialed-execution requirement

**Stories involved:** Story 7 (Gate enforcement follows the credential, and the gate never
degrades to an empty pass) — internal to the story
**Files:** `.docs/stories/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md`
**Type:** state-conflict
**Severity:** degrading

**Description:**

Story 7 requires that a credential-absent leg in gate mode be "recorded as an explicit, named
non-gating skip … and the run is not failed by its absence", and separately that "given no
credentialed leg ran at all … it fails". Tested in both directions, these are **not** mutually
exclusive — satisfying per-leg tolerance leaves the aggregate requirement satisfiable, so this is
not an oscillation. What was missing is the **ordering** that makes them coherent: the aggregate is
evaluated after every per-leg resolution.

Left unstated, the ambiguity is a realistic source of rework: an implementer applying per-leg
tolerance alone ships a tier that passes with zero credentialed legs, and an implementer applying
gate-mode strictness per leg ships one that fails the moment a single credential is absent — the
exact failure Story 3's isolation requirement forbids.

**Resolution Options:**
1. State the precedence explicitly in Story 7 — per-leg resolution first, aggregate check last.
2. Leave it to the plan to sequence.
3. Drop the aggregate requirement and rely on per-leg enforcement alone.

**Recommendation:** Option 1. Option 3 reintroduces the empty-pass hole that
`adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` and the existing
`assertGateCredentialedExecution` invariant exist to close. Option 2 leaves an acceptance
criterion ambiguous, which is where the rework originates.

**Applied:** Option 1. Story 7's negative path now states the aggregate check is evaluated after
every per-leg resolution, so tolerance and the aggregate requirement are ordered rather than
competing.

---

## Pairs examined and found clean

Each pair below shares a behavior, entity, field, or gate and was tested in **both** directions.

| Pair | Both-directions result | Basis |
|---|---|---|
| Story 6 (coverage guard passes when a credential is absent) vs Story 7 (gate enforcement keyed to credential presence) | clean | Different mechanisms in different runs: Story 6's guard is a hermetic structural test in the ordinary suite with no dispatch and no credential; Story 7 governs gate mode of the opt-in smoke tier. Satisfying either leaves the other untouched. `adr-2026-08-12-live-provider-coverage-from-plugin-registry` states the separation as a decision ("The check is deliberately **not** credential-conditional"), so the two are reconciled at the ADR level, not merely compatible by accident. |
| Story 3 (isolation) vs the existing `assertGateCredentialedExecution` invariant | clean | Verified in source: `runSmoke` records a failure with `failure ??=` and continues its loop, emits the complete per-file ledger, and only then throws — so one leg's failure neither halts the other leg nor suppresses its ledger line. The aggregate assertion runs after the loop. |
| Story 3 (isolation) vs Story 7 (gate enforcement) | clean | Story 7's per-leg enforcement is exactly the mechanism that delivers Story 3's isolation; the aggregate check is global and provider-neutral, so it cannot attribute one provider's absence to another. |
| Story 4 (cost ceiling) vs Story 2 (shared body) | clean | The cap and metering live in the shared body and are provider-neutral by construction. Story 4 adds no provider-specific assertion; its Codex-shaped-usage negative path requires the shared meter to record or report-as-unmetered, never to special-case a provider. |
| Story 5 (diagnostics parity) vs Story 2 (shared body) | clean | Story 5 explicitly requires the *same* provider-agnostic diagnostics path "not a Codex-specific copy", which is Story 2's requirement restated. The provider-specific readiness diagnostic Story 5 permits comes from `CodexProvider`'s own existing `logReadinessDiagnostic`, i.e. from the provider, not from a branch in the shared body. |
| Story 1 (Codex leg) vs `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` | clean | Story 1 asserts terminal state, committed artifacts, and the fixture's four outcome keys. No scenario asserts a turn count, an output shape, or agent phrasing. |
| Story 1 (provisioning and teardown) vs `adr-2026-08-04-live-tier-provisions-its-own-provider-home` | clean | Story 1's negative paths require teardown on both branches and an unchanged checkout under test, which restate that ADR's copy-never-link and teardown guarantees rather than relaxing them. |
| Story 1 (Codex command rendering) vs `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | clean | Story 1 requires the Codex rendering (`$name`) via the existing `providerKey` parameter of the step-command preflight, which is that ADR's mechanism. |
| Story 1 (readiness negatives) vs `adr-2026-07-29-codex-readiness-probe-failure-disposition` | clean | Story 1 requires an unready or probe-failed state to fail before paid dispatch, naming the state and its remediation. That is the disposition the ADR defines; the story consumes it and does not redefine it. |
| Story 6 (coverage guard) vs `adr-2026-08-07-worktree-removal-coverage-guard` | clean, and pattern-consistent | That ADR establishes this repository's precedent for a structural enumerate-and-classify guard with an explicit exemption registry and fail-closed treatment of unresolvable cases. Story 6 follows the same shape. Noted for the plan: the exemption-registry half of that precedent is the natural answer to the burden this guard places on adding a provider. |
| Stories 1–7 vs stories for the three merged live-tier features (`daemon-e2e-smoke-step-has-no-real-agent-live-llm-t`, `live-daemon-e2e-build-step-never-runs-a-real-agent`, `no-release-time-smoke-or-eval-gate-releases-cut-wi`) | clean | Those features established the live tier, its provisioned home and preflight, and the capability model and release gate respectively. These stories extend all three along a provider axis none of them addressed. No assertion in any of them is contradicted; `adr-2026-08-02`'s falsified expectation about *how easy* the extension would be was amended during architecture-review and is a forecast, not a behavioral assertion. |

**No ADR-versus-story conflict is recorded.** Every candidate was checked for a pair of verbatim
opposing sentences and none was found. Where an ADR's expectation proved wrong — the
"one entry plus one credential var" sentence in `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` —
it was amended in place during architecture-review under the accepted-artifact amendment rule, so
no conflict survives into this check.

## Advisory: unmerged branches touching the same files

Not conflicts (no merged assertion is contradicted), surfaced so `/plan` can sequence around them:

- `origin/spec/codex-readiness-distinguishes-unavailable-doctor-p` — touches Codex readiness
  classification, which Story 1's readiness negative path depends on. If that spec lands first and
  renames or resplits readiness states, Story 1's wording ("unready or probe-failed") may need to
  track it. Deliberately phrased against the *disposition* rather than a specific state name to
  reduce that coupling.
- `origin/spec/per-step-provider-routing-927` — touches provider selection. It does not touch the
  smoke tier's provider descriptors, so the surfaces are adjacent rather than shared.
- `conduct-ts overlap-scan` additionally reported `smoke-capability.ts` overlapping ~29 spec
  branches. That is a low-signal artifact of the file's recency: branches based on an older main
  show the whole file as a difference.

## Re-check

Re-ran the full pairwise scan after applying both resolutions. Conflict 1's oscillation no longer
reproduces in either direction: the descriptor-driven uniform assertion satisfies Story 1 without a
provider-specific branch, and Story 2's restated preservation clause admits it as a strengthening.
Conflict 2's ordering is now explicit. **Zero blocking conflicts remain; zero degrading conflicts
remain unresolved.**
