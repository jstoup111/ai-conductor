# Architecture Review: Codex Safety and Self-Host Parity (#907)

**Date:** 2026-07-25
**Input reviewed:** Approved PRD FR-1 through FR-15; approved component and sequence diagrams
**Complexity:** Medium (lightweight review: feasibility and alignment)
**Verdict:** APPROVED WITH CONDITIONS

> **Amended 2026-07-26 after conflict-check:**
> `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`
> supersedes the originally approved ADR. The operator selected concurrent task-local
> telemetry and strict minimal self-host isolation for both Claude and Codex.

> **Approval recorded 2026-07-26:** James Stoup approved
> `adr-2026-07-25-provider-neutral-safety-authority` and the aligned component and
> task-safety sequence updates. Condition 1 is satisfied.

## Feasibility

The feature is feasible in the existing TypeScript conductor without a new package,
service, datastore, protocol, external account, or schema migration.

Verified current seams:

- `task-status.json` already represents multiple `in_progress` rows, while task
  completion remains with judgment gates; the singular stamp is not required authority.
- `conductor.ts` already owns BUILD/SHIP phase markers, provider dispatch/retry
  boundaries, self-host detection, and terminal `finally` cleanup.
- `session-hook-assets.ts` and `worktree-prepare.ts` already provide engine-generated
  early guards and per-worktree lifecycle wiring for Claude.
- `phase-marker.ts` already resolves the protected `.docs/` allowlist; the missing
  piece is a durable engine seal/audit that covers non-hook mutation surfaces.
- the self-host guardrail bundle already gives one injectable production seam for
  environment provisioning, live-checkout fencing, and terminal cleanup.
- #905 supplies the selected Codex auth source and bounded unattended execution policy;
  #907 can consume that contract without duplicating authentication logic.
- #904 supplies candidate-local `$skill` invocation, `AGENTS.md`, and the ordinary Codex
  user catalog under `$HOME/.agents/skills`; #907 must replace only the self-host child's
  discovery home with worktree-owned links so live user skills are not inherited.
- current Codex 0.145.0 supplies stable lifecycle hooks, `--ignore-user-config`,
  `--ephemeral`, explicit workspace sandboxing, and per-run configuration overrides.
  Official documentation warns that hooks are not a complete boundary, matching the
  proposed early-guard/engine-audit split.
- a direct Linux sandbox probe verified that a Codex workspace rooted at this feature
  worktree can write inside it but cannot write the parent live checkout.

The highest implementation risk is incomplete production wiring, not unknown
technology. The design deliberately treats exact Codex hook payload compatibility and
cached-auth representation as non-load-bearing: adapter incompatibility loses immediate
feedback but cannot pass the engine audit; an auth source that cannot be isolated stops
before model work.

Performance cost is bounded filesystem hashing/status work at phase entry and provider
dispatch boundaries. The protected tree and live-checkout/config fingerprint sets are
small; manifests must be path-bounded and must not recursively hash unrelated operator
state.

Worktree concurrency remains governed by the existing pipeline overlap/dependency rules.
Within one feature, multiple mutation-bearing tasks may run concurrently because task
identity is task-local telemetry rather than a workspace-global lease. Protected-artifact
and self-host boundaries remain shared deterministic authorities independent of attribution.

## Alignment

The proposed authority extends existing engine seams rather than adding a second provider
framework:

- provider-aware step routing from #927 selects the provider; it does not own safety policy;
- #905 selects and validates auth; #907 receives only that typed selection;
- provider-local hooks normalize lifecycle events and provide early feedback;
- engine state and deterministic audits decide whether mutations are accepted; and
- existing build review/judgment gates remain the only completion authority.

This preserves the written “deterministic where possible” architecture. It also preserves
the established two-layer write-fence pattern: preventive hooks/sandboxing reduce recurrence,
while deterministic engine inspection is the load-bearing backstop. The new durable artifact
seal closes the existing resume hole by refusing to refresh its baseline from a workspace that
may already contain protected drift.

The approved #907 component and sequence diagrams remain accurate. The ADR resolves the
previously open placement question by assigning policy and terminal acceptance to the
conductor safety boundary, with Claude/Codex hooks and sandboxes as provider integrations.
No system-context, container, or ERD change is required.

## Wiring Surface

| Production surface | Design-time production wiring |
|---|---|
| Provider-neutral safety authority and verdict | Constructed by the conductor and invoked around every BUILD/SHIP provider attempt before the raw provider runner |
| Concurrent task telemetry | Dispatch validates the prompt's plan-task id; task rows independently enter/leave `in_progress`; explicit commit trailers are validated but remain non-blocking telemetry |
| Protected-artifact seal | Created once from approved committed DECIDE artifacts at first BUILD entry; checked before and after every BUILD/SHIP dispatch using `phase-marker.ts` allowlists |
| Claude lifecycle adapter | Engine-owned hooks/settings are generated inside a minimal throwaway `CLAUDE_CONFIG_DIR`; no personal settings or hooks are copied |
| Codex lifecycle adapter | Engine-generated hooks are installed in the isolated run configuration for early task/docs rejection; missing/disabled hooks cannot bypass terminal audit |
| Provider-aware self-host provisioner | Selected by `runSelfBuildDispatch` after actual-provider resolution; both providers receive minimal isolated homes with only selected auth, engine controls, and worktree harness assets |
| Codex throwaway home | Provisioned through the self-host guardrail bundle from #905's selected auth source; cached credentials use an opaque restricted temporary handoff; passed to `codex exec`, then torn down in terminal `finally` |
| Codex self-host discovery home | Child-only `$HOME/.agents/skills` view points to feature-worktree skills/HARNESS; executable resolved before HOME override; live #904 catalog is not discovered or changed |
| Codex bounded invocation args | `codex-provider.ts` receives isolated env plus `--ignore-user-config`, `--ephemeral`, worktree root, and #905 sandbox/approval policy for every self-host attempt |
| Live-boundary fingerprint verifier | Called before Codex self-host launch and on every terminal path; covers the live checkout and unrelated operator config while excluding the selected auth source |
| Pipeline task concurrency | Existing non-overlap/dependency scheduling remains; implementation tasks and judgments may run concurrently without a singular mutation lease |
| Installation and documentation contract | `bin/install`, observability/self-host docs, architecture links, and the Unreleased CHANGELOG migration section explain the new provider-neutral authority |

## Early Overlap Scan

The advisory scan reports broad historical/unmerged branch overlap because the wiring
surface contains central conductor, provider, hook, installer, and pipeline files. The
actionable active overlaps are:

- `spec/codex-auth-sandbox-readiness-905` on `conductor.ts` and `codex-provider.ts`;
- `spec/first-class-codex-harness-parity-904` on skill discovery, candidate-local invocation,
  repository guidance, installer behavior, and shared skill contracts;
- `spec/per-step-provider-routing-927` on provider dispatch and pipeline wiring; and
- existing task-stamping/docs-guard/self-host branches on the hook, marker, worktree,
  and sandbox files.

This does not block #907. The plan must layer #907 behind the #905/#927 contracts, keep
commits narrow by seam, and run the sanctioned finish-time rebase after those dependencies
land instead of duplicating their implementation.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| A raw provider retry or auxiliary path bypasses the safety wrapper | Integration | Medium | High | One wrapper below provider-aware resolution, invoke-site inventory, wiring tests, and as-built reachability sweep |
| A resumed run seals already-mutated protected artifacts as its new baseline | Security | Low | High | Durable first-BUILD seal anchored to approved committed artifacts; pre-dispatch validation; never refresh on drift |
| Codex inherits or mutates unrelated operator state | Security | Low | High | Minimal throwaway `CODEX_HOME`, `--ignore-user-config`, `--ephemeral`, native sandbox, bounded fingerprints, and `finally` teardown |
| Codex self-host discovers #904's live `$HOME/.agents/skills` catalog | Security / integration | Medium | High | Child-only discovery home with worktree links; live-catalog sentinel; ordinary-session regression test |
| Opaque cached credential is leaked or retained | Security | Low | High | No parse/log/hash, restrictive permissions, no symlink, unchanged-source check, and all-terminal-path cleanup |
| A workspace-global stamp misattributes concurrent task commits | Data | Medium | High | Remove it as authority and auto-stamp source; preserve/validate explicit task-local trailers |
| Minimal Claude home omits a required engine control | Integration | Medium | High | Generate an explicit required-settings manifest and fail closed before dispatch if incomplete |
| Codex hook schema/coverage changes | Integration | Medium | Medium | Provider-local adapter tests and actionable warning; engine audit remains authoritative |
| #905/#927 land conflicting edits in central files | Integration | High | Medium | Depend on their typed contracts, narrow commits, overlap-aware plan, finish-time rebase |
| Audit hashing adds noticeable dispatch latency | Performance | Low | Low | Bound manifests to protected/live surfaces and hash only changed/status-reported candidates where possible |

## ADRs Created

- `adr-2026-07-25-provider-neutral-safety-authority` — superseded after conflict-check.
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` — APPROVED;
  retains engine-owned artifact/live boundaries while making task attribution concurrent
  telemetry and isolating both built-in provider homes.

## Conditions

1. **Satisfied 2026-07-26:** The operator approved the ADR before stories were authored.
2. The implementation must consume #905's selected-auth/readiness contract and #927's
   provider-aware runtime; it must not duplicate either policy if those branches land first.
   It must also preserve #904's candidate-local invocation and ordinary user catalog while
   overriding only self-host discovery.
3. Every initial, retry, resume, grouped, auxiliary BUILD/SHIP, and provider-replacement
   path must invoke the safety wrapper; partial migration is blocking.
4. Mutation-bearing task dispatches remain concurrent when pipeline overlap/dependency rules
   permit; no workspace-global task stamp may authorize mutation or replace explicit attribution.
5. Hooks may improve rejection latency but may never be the sole evidence for a PASS safety
   verdict.
6. Claude self-host must use minimal isolated configuration like Codex; removing inherited
   personal settings/hooks and live global relink is an intentional, documented compatibility change.

## Blocking Issues

None after ADR approval. The verified technology and dependency contracts support the
design; the conditions are implementation and sequencing constraints for `/plan` and
as-built review.
