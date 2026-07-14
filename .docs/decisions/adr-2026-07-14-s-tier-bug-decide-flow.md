# ADR: Lightweight DECIDE flow for size-S bugs — one mini-spec, gates satisfied by construction (#668)

**Date:** 2026-07-14
**Status:** APPROVED
**Approved-By:** jstoup111 (operator-initiated request 2026-07-14)
**Track:** technical · **Tier:** M · **Issue:** jstoup111/ai-conductor#668

## Context

An S-tier bug (1–3 tasks) has two bad options today. Running full `/engineer` DECIDE
(explore → complexity → architecture-review → stories → conflict-check → plan) is heavyweight
ceremony for a one-file fix. Skipping DECIDE with an ad-hoc hotfix worktree (tonight's #634/#644/
#548) produces **no** `.docs/` artifacts, so the daemon's autonomous-build gates have nothing to
read and every gate-satisfying field has to be hand-stamped afterward — which failed three ways:

- **#656 — owner-gate skipped 4 specs.** `decideSpecGate` (`owner-gate/gate.ts:56-74`) treats a spec
  with no `Owner:` stamp as un-owned and drops it to the grandfather cutover. The stamp is read by
  `readSpecOwnerStamp` (`owner-gate/provenance.ts:34-49`) from `.docs/intake/<slug>.md`, and the only
  writer is `writeIntakeMarker` (`engineer/intake-marker.ts:44`), reached only via
  `land --source-ref`. A hotfix never calls it.
- **#662 — ADR defaults to DRAFT and the gate trips late.** `hasDraftAdr` (`artifacts.ts:1876-1878`)
  matches `Status: DRAFT`; `land-spec.ts:267-277` and `authoring.ts:432-438` throw on any DRAFT ADR.
  An S-bug that authored an ADR at all left it DRAFT.
- **#625 — stories lacked `Status: Accepted`.** `isStoriesApproved` (`artifacts.ts:1860-1863`)
  requires it; `daemon-backlog.ts:605-611` warn-skips the merged spec otherwise.

The `size: S` label (added with #643) already exists as a trigger signal, but nothing binds it to a
lighter authoring path, and the build pipeline already skips the heavy DECIDE-audit steps for Small
(`steps.ts` `skippableForTiers: ['S']`; `conductor.ts:1614-1623`). So the only real cost is
authoring ceremony and the post-hoc stamping it forces.

## Decision

Introduce a first-class **S-tier mini-spec** authoring path, triggered by `size: S` **and** `bug`,
that produces one combined artifact and stamps the gate-satisfying fields **by construction**.

### D1 — Label-authoritative trigger (deterministic)
`engineer claim` reads the claimed issue's labels directly. When both `bug` and `size: S` are
present it returns `{ sTier: true, tier: 'S', class: 'bug', owner }`. The `size: S` label is the
authoritative tier: a new `resolveTierFromLabels(labels)` in `complexity.ts` maps it to `Tier: S`,
**bypassing** the LLM `assessTier` signal walk (`complexity.ts:30-50`). A `size: S` issue without
`bug`, or any `size: M/L`, does **not** enter the S-flow.

### D2 — One mini-spec artifact
The host agent authors a single `.docs/s-tier/<slug>.md` from
`templates/s-tier-mini-spec.md.template`: a header (`Owner`, `Track: technical`, `Tier: S`,
`Status: Accepted`, `Issue`) and a body of Problem · Root-cause anchor (`file:line`) · Fix sketch ·
**RED test list** (named failing tests) · Acceptance (observable outcomes). This replaces the
separate explore/stories/plan docs for an S-bug.

### D3 — Deterministic expand + stamp at land
A new `landSTierSpec` (a branch of the existing `land` primitive, selected when a
`.docs/s-tier/<slug>.md` is present) is pure machinery — it does not author. It calls
`parseMiniSpec()` then `expandMiniSpec()` to emit the canonical **gate-read** files with stamps
injected: `.docs/intake/<slug>.md` (`Owner:` via the now-unconditional `writeIntakeMarker`),
`.docs/track/<slug>.md` (`Track: technical`), `.docs/complexity/<slug>.md` (`Tier: S`),
`.docs/stories/<slug>.md` (acceptance rendered as stories + `Status: Accepted`), and
`.docs/plans/<slug>.md` (the RED test list rendered as RED-first tasks). Because the expander writes
the exact files the existing gates already read, **no gate reader changes** and the #656/#662/#625
classes cannot recur.

### D4 — Fail-closed validation (by construction)
After expansion, `landSTierSpec` re-runs the **existing** predicates and REJECTS (throws, opens no
PR, keeps the worktree for inspection) on any of: Owner absent/blank (`readSpecOwnerStamp`), stories
not `Status: Accepted` (`isStoriesApproved`), tier ≠ S (`parseComplexityTier`), a present ADR that
`hasDraftAdr`, or an **empty RED test list** (RED-first is preserved — an S-bug with no named failing
test is not landable).

### D5 — No ADR required, none authored
The S-flow authors **no** ADR (Small already skips `architecture_review`). D4's DRAFT-ADR check is a
belt-and-braces guard against a stray ADR sneaking in — it is never *required* to exist.

### D6 — Build pipeline unchanged
`Tier: S` drives the existing `skippableForTiers: ['S']` skips only (architecture_diagram/review,
conflict_check, acceptance_specs, architecture_review_as_built, retro). `build`, `build_review`,
`wiring_check`, `manual_test`, and `finish` run as normal. `build_review`, the TDD domain review,
and `code-review` are **not** in any skip list — no verification is weakened. No change to
`steps.ts`, `conductor.ts:1614-1623`, or the gate readers.

## Consequences

- An S-bug goes idea → build-ready spec from one artifact, with owner/stories/ADR gates satisfied
  before the PR is opened. #656/#662/#625 become unreachable for S-bug specs.
- New surface: one template, `parseMiniSpec`/`expandMiniSpec`, a `landSTierSpec` branch,
  `resolveTierFromLabels`, unconditional `writeIntakeMarker`, and the `engineer` claim/skill trigger.
- M/L DECIDE and non-bug `size: S` ideas are untouched.

## Non-goals

- Changing the M/L DECIDE flow or adding any new tier skip.
- Weakening or bypassing any correctness gate — reviews still run; RED-first still required.
- New gate readers or a new build-time artifact reader — the expander targets existing gate files.
- Auto-merging or auto-approving the build.
