# Coherence Check: Live daemon E2E tier covers only Claude — no real-agent Codex signal (#1264)

**Date:** 2026-08-12
**Tier:** M
**Track:** Technical
**Plan stem:** `live-daemon-e2e-tier-covers-only-claude-no-real-ag`
**Result:** COVERED — zero gaps, zero contradictions

No `fr` rows are required: this is a technical-track spec with no PRD, so acceptance criteria
live directly in the stories. Outcome ids are 1-based in the order the bullets appear under the
**Desired outcome** heading of jstoup111/ai-conductor#1264, confirmed against the staged
`.pipeline/intake-outcomes.md` (five bullets, `Source-Ref: jstoup111/ai-conductor#1264`).

The `adr` row class covers the three `.docs/decisions/adr-*.md` files in this spec's change set:
two newly authored, and one amended in place during architecture-review under the
accepted-artifact amendment convention.

Every `covered` verdict below was confirmed by reading the counterpart id in its own artifact
file, not inferred from a phrase match. The §4d consistency pass was run over every covered row,
with cross-layer pairs (outcome↔task, ADR↔story) tested in both directions; the one genuinely
close call is recorded in the `outcome-5` row's notes rather than left implicit.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | "The live daemon E2E tier produces a pass/fail verdict for a real Codex agent driving the same committed fixture through the same claim-to-finish path." Story 1 tags DO-1 and asserts the same four outcome keys the Claude leg asserts over the same committed fixture; story 2 tags DO-1 and makes "the same path" mechanical by requiring both legs to execute one shared body. |
| outcome | outcome-2 | story-4 | covered | "A Codex run is bounded by the same cost ceiling the Claude run is, and reports its observed cost on success." Story 4 tags DO-2; its happy paths require the same cap mechanism, the same default, the same operator override, and an observed-total report on success. |
| outcome | outcome-3 | story-5 | covered | "A Codex failure prints the same daemon log excerpt and pipeline state the Claude leg prints." Story 5 tags DO-3 and requires the shared provider-agnostic diagnostics path explicitly — "not a Codex-specific copy" — so parity is structural rather than duplicated. |
| outcome | outcome-4 | story-3, story-7 | covered | "Each provider's verdict is independent: one provider's missing credential or absent CLI never suppresses, fails, or masks the other's result." Story 3 tags DO-4 and tests isolation in both directions; story 7 supplies the per-leg gate enforcement that delivers it. Checked against task-7 in both directions: the aggregate credentialed-execution failure is a property of the run, not of one provider acting on another, so it does not re-break independence. |
| outcome | outcome-5 | story-6, story-7 | covered | "Whatever invocation runs the live tier covers every supported provider, so adding a provider to the harness cannot silently leave it uncovered." The load-bearing word is **silently**: story 6's coverage guard is deliberately not credential-conditional, so a registered provider with no leg always fails, while story 7's credential-absent skip is named in the ledger and the step summary rather than silent. Tested for oscillation against task-5: under a maximal reading of outcome-5 ("every provider must actually execute"), tolerating a credential-absent leg would contradict it — but that reading is not what the bullet says, and the operator's 2026-08-12 decision recorded in `adr-2026-08-12-per-provider-live-smoke-legs` settles it. Recorded as covered on that grounding, not on assumption. |
| story | story-1 | task-15, task-16, task-17, task-18, task-19, task-20, task-21, task-22 | covered | Real-provider auth preparation (15), the Codex descriptor (16), the leg itself (17), the constructor-ordering fix (18), credential-less failure before spend (19), absent-binary skip before provisioning (20), unready-readiness stop before spend (21), teardown on both branches with an unchanged checkout (22). |
| story | story-2 | task-1, task-9, task-10, task-12, task-13, task-14 | covered | The descriptor manifest and its type (1), the extraction (9), proof that no Claude assertion was weakened (10), the structural ban on provider-specific branches (12), the uniform descriptor-driven auth-source assertion (13), and the leg-shape check keeping a leg to a descriptor and a call (14). |
| story | story-3 | task-2, task-3, task-4, task-11, task-29, task-30 | covered | The per-provider capability members (2), advisory resolution (3), gate resolution (4), the Claude leg's own capability-declaring file (11), both-directions isolation with an intact ledger line on one leg's failure (29), and environmental disjointness between concurrent legs (30). |
| story | story-4 | task-23, task-24, task-25 | covered | Cap and observed-total reporting shared by both legs (23), cap enforcement on the failure branch (24), and the unmetered/unattributable metering floor applied uniformly (25). |
| story | story-5 | task-26, task-27, task-28 | covered | The shared diagnostics dump on the failure branch (26), hardening against an absent worktree or empty daemon log so diagnostics never mask the original failure (27), and presence-only credential reporting (28). |
| story | story-6 | task-31, task-32, task-33 | covered | The registry-derived guard in its passing direction (31), its failing directions plus credential-independence (32), and reconciliation of the pre-existing hardcoded capability map with the manifest (33). |
| story | story-7 | task-5, task-6, task-7, task-8, task-34 | covered | The named non-gating skip (5), credential-presence-keyed enforcement (6), ordering the aggregate after per-leg resolution (7), the force-skip failure (8), and the per-leg workflow credential check, smoke selection, and step summary (34). |
| task | task-1 | story-2 | covered | Infrastructure. Supplies the descriptor manifest and type that story 2's shared body, and three other consumers, read. |
| task | task-2 | story-3 | covered | Infrastructure. Adds the per-provider credentialed members without which a second leg cannot declare its own credential. |
| task | task-3 | story-3 | covered | Delivers story 3's advisory-mode criterion that each capability resolves against its own provider's credential variable. |
| task | task-4 | story-3 | covered | Delivers the same criterion in gate mode, where the isolation requirement actually bites. |
| task | task-5 | story-7 | covered | Delivers story 7's criterion that a credential-absent leg is a named non-gating skip rather than a run failure. |
| task | task-6 | story-7 | covered | Delivers the criterion that a credential-present leg is enforced, and that adding the credential alone flips a skipped leg to enforced. |
| task | task-7 | story-7 | covered | Delivers the criterion that a run with zero executed credentialed legs fails, ordered after per-leg resolution per the conflict-check resolution. |
| task | task-8 | story-7 | covered | Verify-only. Proves the existing force-skip behavior already fails a credentialed leg in gate mode rather than de-gating it; marked `Verify-only: yes` so the advisory work-happened floor does not flag its commit-less completion. |
| task | task-9 | story-2 | covered | Refactor. The extraction itself — the mechanism by which "both legs drive the same path" stops being a maintenance promise. |
| task | task-10 | story-2 | covered | Delivers story 2's negative path that the extraction weakens, removes, or conditionalizes no Claude assertion, and discharges architecture-review condition C-2. |
| task | task-11 | story-3 | covered | Infrastructure. Gives the Claude leg its own capability-declaring file — the file-granularity split that makes isolation structural. |
| task | task-12 | story-2 | covered | Delivers story 2's negative path that a provider-specific branch inside the shared body fails a structural check by name. |
| task | task-13 | story-2 | covered | Delivers story 2's criterion that the auth-source assertion is written once, applies to every leg, and takes its expected value from the descriptor. |
| task | task-14 | story-2 | covered | Delivers the criterion that a leg supplies only a descriptor and adds no provider-specific assertion logic. |
| task | task-15 | story-1 | covered | Refactor. Routes home provisioning through the real provider's `prepareSelfHostAuth`, so the leg exercises `CodexProvider`'s auth rather than a fixture's imitation of it. |
| task | task-16 | story-1 | covered | Infrastructure. Declares the Codex descriptor including its expected authentication source. |
| task | task-17 | story-1 | covered | Delivers story 1's happy path: a Codex leg over the shared body driving the committed fixture with the Codex command rendering. |
| task | task-18 | story-1 | covered | Delivers story 1's first negative path — the constructor-ordering hazard, grounded in `codex-provider.ts:169`, asserted through the descriptor's expected source. |
| task | task-19 | story-1 | covered | Delivers the negative path that a leg with neither an API key nor a cached login fails naming the credential and the path searched, with zero dispatches. |
| task | task-20 | story-1 | covered | Delivers the negative path that an absent provider binary reports an unmet toolchain requirement and provisions nothing. |
| task | task-21 | story-1 | covered | Delivers the negative path that an unready or probe-failed readiness result stops the leg before paid dispatch, carrying the state and its remediation. |
| task | task-22 | story-1 | covered | Delivers the negative path requiring teardown on both branches and a byte-for-byte unchanged checkout under test. |
| task | task-23 | story-4 | covered | Delivers story 4's happy paths: same cap mechanism, same default, same override, and an observed-total report naming total, dispatches, and cap. |
| task | task-24 | story-4 | covered | Delivers the negative path that an over-cap total fails naming cap, observed total, and unmetered count — on the failure branch as well as the success branch. |
| task | task-25 | story-4 | covered | Delivers the remaining negative paths: an unmetered pre-publication dispatch, an unattributable dispatch, and an unrecognized provider-shaped usage value reported rather than discarded. |
| task | task-26 | story-5 | covered | Delivers story 5's happy path that a Codex failure dumps the daemon log excerpt and pipeline state through the shared path, with the provider's own readiness diagnostic alongside. |
| task | task-27 | story-5 | covered | Delivers the negative paths for an absent worktree and a missing or empty daemon log, so diagnostics never mask the original failure. |
| task | task-28 | story-5 | covered | Delivers the negative path that no credential value reaches a log, diagnostic, or step summary, and discharges architecture-review condition C-3. |
| task | task-29 | story-3 | covered | Delivers story 3's both-directions isolation negative paths, including an intact ledger line for the surviving leg when the other fails outright. |
| task | task-30 | story-3 | covered | Delivers the negative path that concurrent legs' child environments carry only their own provider's home variable and credential. |
| task | task-31 | story-6 | covered | Delivers story 6's happy paths: registry-derived enumeration, a leg and capability entry required per provider, and no dispatch, credential, or binary needed. |
| task | task-32 | story-6 | covered | Delivers the failing directions — no leg, no capability entry, a dead entry for a removed provider — plus the credential-independence criterion, discharging condition C-4. |
| task | task-33 | story-6 | covered | Refactor. Reconciles the pre-existing hardcoded capability map with the manifest so the two inventories cannot silently diverge. |
| task | task-34 | story-7 | covered | Infrastructure. Makes the workflow matrix load-bearing: per-leg credential check, per-leg smoke selection, per-leg step summary naming the provider and its gating state. |
| adr | adr-2026-08-12-per-provider-live-smoke-legs | story-1, story-2, story-3, story-7 | covered | Decision 1 (one file per provider over one shared body) is implemented by stories 2 and 3; decision 2 (per-provider capability dimension) by story 3; decision 3 (gate enforcement follows the credential, coverage guard does not) by story 7; decision 5 (identical outcome assertions, per-leg cap) by stories 1 and 4. Checked in both directions: no story scenario requires behavior the ADR forbids, and the ADR's stated negative consequence about the constructor-time auth ordering is honored by story 1's first negative path rather than contradicted. |
| adr | adr-2026-08-12-live-provider-coverage-from-plugin-registry | story-6 | covered | The decision — enumerate from the production registry, fail when a registered provider has no leg, and stay deliberately non-credential-conditional — is story 6's subject in full, including the ADR's explicit separation of a missing credential from a missing leg. The ADR's two follow-up actions (reconcile the structural map, name the uncovered provider in the failure) are carried as tasks 33 and 32 rather than deferred. |
| adr | adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate | story-3, story-7 | covered | Amended, not superseded, during architecture-review: an additive note beside its falsified "one entry plus one credential var" expectation, with the original text preserved. Its actual decisions — manual dispatch, the reusable `workflow_call` gate, and `require_credentials` semantics — remain authoritative and are honored by stories 3 and 7, which change what each matrix leg does without changing the workflow's trigger shape or its fail-closed contract. |

## Consistency pass (§4d)

Cross-layer pairs sharing a subject were tested in both directions. Three were close enough to
warrant recording:

- **outcome-5 ↔ task-5** — the credential-absent skip versus "covers every supported provider".
  Resolved as `covered` on the bullet's own wording ("cannot **silently** leave it uncovered")
  plus the operator decision recorded in `adr-2026-08-12-per-provider-live-smoke-legs`. Grounded,
  not assumed. This is the only row where a different reading of the intake text would change the
  verdict, which is why it carries its reasoning inline.
- **outcome-4 ↔ task-7** — per-provider independence versus the aggregate failure when no
  credentialed leg ran. Not an oscillation: the aggregate is a property of the run as a whole and
  attributes nothing to either provider, so satisfying it leaves independence intact, and
  satisfying independence leaves the aggregate reachable.
- **story-2 ↔ story-1** (auth-source assertion versus the provider-agnostic shared body) — this
  *was* a genuine oscillation and was caught and resolved during `/conflict-check`, not here. The
  resolution (descriptor-carried expected auth source) is reflected in tasks 13, 16, and 18, and
  re-testing both directions against the amended story text no longer reproduces it.

No `fail` row was recorded, and no contradiction remained requiring an accepted-artifact
amendment during this pass.
