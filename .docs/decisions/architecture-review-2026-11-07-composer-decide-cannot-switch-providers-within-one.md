# Architecture Review: Composer runs checkpoint, resume, switch provider, and hand off (#2050)
**Date:** 2026-11-07
**Inputs reviewed:**
- PRD `.docs/specs/composer-decide-cannot-switch-providers-within-one.md` (FR-1 to FR-31);
- diagram `.docs/architecture/composer-decide-cannot-switch-providers-within-one.md`;
- the track and complexity artifacts;
- ADR-008, adr-2026-07-03-engineer-checkpoint-commits-idempotent-land, adr-2026-07-03-pr-timing-config-key,
  adr-2026-07-29-ship-start-draft-pr, adr-012, adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
  (D9 to D11), and adr-2026-08-08-pipeline-owned-closeout-timestamps (D2);
- the source of land, handoff, worktree, intake, launcher, owner-gate, guarded publication and events.
**Mode:** Full (Tier L)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The current stack can build it, with no new dependency, service or container. Each requirement is
listed with its support. "Verified" means read in source; "inferred" means not verified.

- **FR-1, FR-2, FR-4 (save on acceptance).**
  - Verified: land is already idempotent (`land-spec.ts:903-916`).
  - Verified: guarded push exists as `executeRemoteGit` (plain push, `remote-git-operations.ts:295-399`).
  - New: a `compose checkpoint` primitive (ADR D4).
- **FR-3 (mid-step save).**
  - Verified: the launcher already waits for the host to exit (`engineer-cli.ts:735-746,1288-1326`),
    so it can auto-save drafts after the session (D8).
  - For a session not started by the launcher, resume's local-leftover handling covers it (FR-15, D6).
- **FR-5 to FR-7 (pickup surface).**
  - Verified: `pull-request.create` supports `draft`, and `pull-request.ready` and `pull-request.edit`
    exist (`github-operations.ts:102,255-256`; `tracker-client.ts:299-312`).
  - Verified: provenance has to exist before the first push (`mutation-policy.ts:122-167`). So the
    first checkpoint writes the owner marker, which only `land` writes today.
- **FR-8 to FR-10 (guided transitions).**
  - Verified: the launcher loop, and provider resolution by `resolveComposeLaunchHost` plus
    `requireProviderCapability('interactiveLaunch')` (`compose-launch-host.ts:9-27`,
    `engineer-cli.ts:1230-1235`).
  - Needed: a way to correlate a session with its run. The launcher's per-launch id travels in run
    events (D8), so no sidecar file is needed.
- **FR-11 to FR-15 (resume).**
  - Verified gap: the worktree reconcile cannot attach a remote-only branch (`worktree-shared.ts:51-68`).
  - New: a `fetched` reconcile, plus resume's leftover handling (D6).
  - Today a dirty reuse is refused (`worktree-authoring.ts:101-119`); resume replaces that refusal
    with an explicit operator choice.
- **FR-14 (no lost work).** Verified: pushes are never forced unless stack state applies, which
  `spec/*` never has. A non-fast-forward rejection gives the protection.
- **FR-16 to FR-20 (comments).**
  - Verified: no review-comment read or reply operation exists (agent sweep). They need new GitHub read
    and feature-write operations.
  - Verified: `sanitizeInboundText` takes a `{kind:'github'}` work ref, and a PR number fits it.
  - Feasible, but deferred to the follow-up spec (D12).
- **FR-21, FR-22 (switching).**
  - Verified: no existing event distinguishes a deliberate switch; `provider_fallback` and
    `step_retry` are scoped to pipeline steps (`types/events.ts:1306-1355`).
  - New: kinds in the composer event ledger (D10).
  - An unavailable provider is already refused at `requireProviderCapability`.
- **FR-23, FR-24 (intake integrity).**
  - Verified: the ledger is per machine (`engineer-store.ts:180-188`).
  - Verified: stale reaping skips entries that have a `prUrl` (`stale-claim.ts:12-21`).
  - Verified: the delivery guard heals an open PR to `done` (`delivery-guard.ts:307-439`). That has to
    learn about draft PRs (D9).
  - Inferred (ADR A4): finding the spec PR from the issue via its cross-reference.
- **FR-25, FR-27 (delivery).**
  - Verified: handoff fails when a PR already exists (`handoff.ts:218-240`).
  - New: a ready-existing path with a create fallback (D7). It reuses the decisions of
    adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.
- **FR-26 (delivery gate).**
  - Drafts are covered by digest-bound acceptance (D3, D7).
  - The comment half is deferred (D12).
- **FR-28 to FR-30 (compatibility).**
  - Verified: no remote means commit only (handoff no-remote path, `handoff.ts:203-206`).
  - Existing primitives stay callable on their own.
- **FR-31 (ownership).**
  - Verified: the daemon builds by the committed owner stamp (`daemon-backlog.ts:540-557`).
  - Verified: the explicit-approval bypass exists (`remote-git-operations.ts:303-325`).
  - Inferred (A3): a committed re-stamp authorizes the following pushes.

**Prerequisites:** none. #1975 and #1472 have no landed spec; D10 stays additive and does not take
their scope.

**Worktree isolation:**
- No new ports, databases or shared services.
- The run record is per branch. Composer events go to the target's `.pipeline/`, which is already
  outside the live-boundary fingerprint.
- Backup branches are local and per slug.

## Complexity

**High.**
- It adds three primitives (`checkpoint`, `resume`, and the launcher boundary) and a new durable
  record.
- It changes land, handoff, worktree, the delivery guard and the composer skill.
- It adds a cross-session state machine for runs.

About 20 to 24 tasks were estimated for the full PRD, which is at the plan ceiling. The operator chose
a two-spec split, with spec 1 live and no flag (ADR D12). Spec 1 is estimated at 15 to 17 tasks.

## Alignment

- **ADR-008:** retained (ADR D13). The loop is still host-agent-owned and human-gated, now across
  sessions. No one-shot authoring or authoring subprocess is introduced; resume launches the
  interactive host exactly as the launcher does (adr-2026-09-24 D9).
- **adr-2026-07-03-engineer-checkpoint-commits-idempotent-land:** applied to the Composer flow as its
  Decision items 1–3. Item 4 (worktree lifecycle) is unchanged.
- **adr-2026-07-03-pr-timing-config-key and adr-2026-07-03-engineer-checkpoint-commits-idempotent-land:**
  both say the engineer flow is byte-identical when the key is absent, and D1 falsifies that. Each
  carries an additive amendment note (conflict-check resolution, 2026-11-07). The `pr_timing` feature
  was never built: PR #267 closed unmerged and #199 is closed.
- **adr-2026-09-11-github-operation-ownership D2:** it requires every remote feature-branch write to
  match the committed owner. D11's teammate take-over contradicts that, so D2 gains an additive note
  allowing an operator-run take-over on a pre-merge spec branch under one exact interactive approval.
  Declining leaves the operator local-only (conflict-check resolution, 2026-11-07).
- **adr-2026-07-04-claim-time-delivery-evidence-guard D1:** unchanged. The draft PR URL is held in a
  separate `draftPrUrl` field, so an in-flight run is the existing "beyond `pending` with no `prUrl`"
  case (ADR D9).
- **adr-012:** the ledger stays the single dedup authority. D9 adds a remote in-flight signal, which
  is consistent with its D5 cross-host anchor intent.
- **Event spine:**
  - The run record is state (exception C): it is read by name as the authority.
  - Run transitions are occurrences, emitted as new `ConductorEvent` kinds into the existing composer
    sibling ledger (exception B, same schema).
  - No parallel channel is added. The launcher correlates sessions through those events.
- **Domain boundaries:**
  - Owner-gate policy is unchanged. D11 composes it: a re-stamp is an ordinary committed provenance
    change, and the decline path uses the existing explicit-approval capability.
  - Guarded publication is reused, with no raw `gh` or `git` writes.
- **Scope decision (scope-check):** consumer-facing, because the Composer CLI and the shipped
  `skills/composer` run in every registered project. No self-host path is touched. It is
  provider-agnostic: it works for every provider that declares `interactiveLaunch` (Claude and Codex
  today).
- **Security:**
  - Comment text is untrusted; its handling is deferred to spec 2, where sanitization is mandatory.
  - An owner take-over needs an interactive confirmation plus one exact explicit approval for the
    push, and it is recorded in the owner history.
  - A daemon or engine session never takes over.
  - No assignee is ever changed.

## Domain Integrity

- **Run step state:** the discriminated `accepted | draft`, plus a separate `needsReconfirm` set, not
  booleans. Consumers switch on it exhaustively.
- **Resume target:** parsed once into a discriminated `{kind: 'pr' | 'branch' | 'intake'}` before any
  I/O ("parse, don't validate").
- **Launcher boundary choice:** a discriminated `continue | switch(provider) | handoff`, where
  `switch` carries a provider id validated against the catalog.
- **Digests:** typed as `ArtifactDigest` (a path plus a SHA-256 hex digest), not bare strings in
  logic.
- **Ownership outcome:** `transferred | retained`, carried on the resume event.

No veto.

## Wiring Surface

- `compose checkpoint`
  - Registered in the `EngineerDispatchDescriptor` union, `ENGINEER_SUBCOMMANDS`,
    `parseEngineerCommand`, `SUBCOMMAND_HELP` and the `dispatchEngineer` switch (`engineer-cli.ts`).
  - Called in production by the Composer skill after each accepted step, and by the launcher's
    post-exit auto-save.
- `compose resume`: registered at the same five CLI points; invoked by the operator and by the
  launcher's continue and switch paths.
- The run-record module (`engine/engineer/run-record.ts`): read and written by `checkpoint`,
  `resume`, `land` (the unaccepted-draft gate and the strip) and the launcher.
- The `fetched` worktree reconcile in `engine/worktree-shared.ts`: reached through `resume` and
  `compose worktree`.
- The ready-existing path in `handoff.ts` (`openSpecPr`): reached from the existing `compose handoff`
  dispatch.
- The draft-PR in-flight handling in `delivery-guard.ts`: reached from the existing `compose claim`
  path.
- The launcher post-exit boundary prompt and its per-launch id: inside the existing `launch` case
  loop in `dispatchEngineer`.
- The new `ConductorEvent` kinds: emitted by the primitives above into the composer event ledger;
  registered in `EVENT_SINKS` (`event-sinks.ts`) and the `EventPersister`.
- The Composer skill (`skills/composer/SKILL.md`): its checkpoint calls and resume mode, consumed by
  both `/composer` and `$composer`.

The early overlap scan (advisory) was run over these paths. Its only hits were on `skills/composer/SKILL.md`, from `spec/composer-hotfix-prs-open-under-the-operator-accoun` (#3428) and `spec/plan-and-composer-skills-surface-the-stacked-deliv` (#3422). Both are squash-merged, so neither is live overlap.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A committed owner re-stamp does not authorize the following pushes (A3) | Integration | Medium | Medium | A plan task verifies this; the fallback is the D11 explicit-approval path |
| The issue-to-PR cross-reference lookup misses an in-flight run, and a third machine claims it (A4) | Integration | Medium | High | The ledger keeps branch and PR on the machines that saved or resumed; the lookup is tested against the cross-reference read; the residual case is a duplicate draft PR, which the operator closes |
| Two operators save concurrently and one is surprised by a refusal | Data | Low | Low | The non-fast-forward refusal names `compose resume`; no work is lost |
| The run-record strip in land breaks a land re-run after it | Data | Medium | Medium | D7 verifies against the strip commit's parent; there is an explicit negative test |
| A gate other than land trips on `.docs/composer-runs/` (A6) | Technical | Low | Medium | A bounded plan task excludes it where needed |
| The launcher's auto-save commits an operator's half-typed scratch file under `.docs` | Data | Low | Medium | The save is a draft only, never accepted; land refuses drafts (D7) |
| Handoff's existing-PR path changes behavior for runs from before this ADR | Integration | Low | Medium | With no PR it falls back to create; a run without a record lands as today (D7) |

## ADRs Created

- `adr-2026-11-07-composer-run-checkpoint-resume-handoff` (APPROVED 2026-11-07, then revised in
  place after the conflict check).
- Amendment notes added to adr-2026-07-03-pr-timing-config-key,
  adr-2026-07-03-engineer-checkpoint-commits-idempotent-land, and
  adr-2026-09-11-github-operation-ownership. They are committed separately, before land.
- ADR-008 is not amended (ADR D13).

## Conditions

- C1 — BUILD verifies ADR assumption A3 before relying on it. A failed check takes the D11
  explicit-approval path; it does not weaken the owner gate.
- C2 — The follow-up comment-resolution intake (ADR D12) is filed and blocked by this spec's issue
  before handoff.
- C3 — Every new `ConductorEvent` kind is registered in `EVENT_SINKS` and the persister in the same
  task that emits it.
- C4 — The plan carries obligation rows for every decision of the three amended on-main ADRs.
