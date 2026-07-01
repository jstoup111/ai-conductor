# Design: Harness Daemon Self-Host Guardrails

**Date:** 2026-06-30
**Status:** Approved
**Track:** Technical (no PRD; acceptance criteria live in stories)
**Complexity:** Tier L
**Companion architecture:** `.docs/architecture/2026-06-30-harness-self-host-guardrails.md`
**Management-plane companion:** `.docs/specs/2026-06-29-daemon-supervised-hosting.md`

## Problem

The `james-stoup-agents` harness repo is the one repo the build daemon **cannot safely
build the way it builds every other repo**, and today it is deliberately kept out of the
registry for that reason (memory: *JSA not daemon-registered*). Registering it would let the
daemon build harness features autonomously — but a harness self-build is a bootstrap hazard:
the daemon would be editing the very skills and hooks it is *actively executing*, on a machine
where the operator runs ~20 concurrent live Claude sessions off the **same global**
`~/.claude/skills` symlinks.

Four concrete failure modes make an unguarded self-build unsafe:

1. **Stale skill symlinks.** New harness skills are not auto-linked on `git pull`; they only
   appear after `bin/install` re-runs (memory: *harness update skips skill symlinks*). A
   self-build that adds a skill and then invokes it HALTs with "Unknown command / no parseable
   result" (observed, PR #153/#160).
2. **Global-config corruption.** A self-build that edits `skills/` or `hooks/` mutates the
   symlink targets the operator's concurrent sessions read live. A mid-build edit to a broken
   intermediate state can break every other running session.
3. **VERSION-bump approval is human-gated.** `CLAUDE.md` requires the operator approve the
   semver bump *before* a PR is opened. In daemon `auto` mode there is no human prompt to
   answer — an unguarded daemon would either skip the bump or guess it.
4. **Release-artifact gates are human-assumed.** The harness has release invariants
   (`test_harness_integrity.sh` green, `CHANGELOG [Unreleased]` non-empty, a `## Migration`
   block for breaking changes) that today rely on the operator running them. A daemon build
   would sail past all three.

The unifying invariant that must survive, carried from **ADR-005** (non-autonomy by
construction) and **ADR-010** (single-owner pidfile lock): **no build proceeds without a
human-merged spec PR, and every harness self-edit is a propose-only PR the operator merges.**
The daemon must never merge itself. So every new guardrail here is **HALT-based** — in `auto`
mode there is no human to prompt, so a guardrail that cannot self-satisfy parks the build for
a human rather than proceeding.

## Solution

A single **harness self-host mode**: one detection seam that recognizes "the repo under build
*is* the harness," which activates a bundle of guardrails attached to existing conductor seams.
When the repo is anything else, every path is byte-for-byte unchanged. Five new components, all
grounded on confirmed code seams:

### 1. `SelfHostDetector` — the activation seam
Resolves whether the repo under build is the harness, reusing the existing
`resolveHarnessRoot()` (`src/conductor/src/engine/install-freshness.ts:31`) compared against the
build's repo root. A config override (below) can force-enable or force-disable. Modeled as a
**swappable seam** exactly like the owner-gate's `IdentityResolver`
(adr-2026-06-30-owner-gate-identity-resolution): today it is a path comparison; in an isolated
remote deployment (EKS) a platform-provided identity can replace path comparison **without
changing what the guardrails do**. Attaches in the daemon discovery/dispatch path
(`engine/daemon.ts` `runDaemon` / `pickEligible`, near where owner-gating already sits).

### 2. `SkillRelinkPreflight` — pre-dispatch freshness (extends `ensureInstallFresh`)
Extends the existing install-freshness preflight (`ensureInstallFresh`,
`install-freshness.ts:96`) so that, for a harness self-build, skill symlinks are relinked from
`bin/install` **before** the build is dispatched. This closes failure mode #1: the daemon never
dispatches a build that would HALT on an unlinked skill. Reuses the existing `InstallRunner`
seam and `InstallStaleError`; no new install mechanism.

### 3. `SandboxBuildEnv` — throwaway `CLAUDE_CONFIG_DIR` isolation
Closes failure mode #2, the safety-critical one. For a harness self-build, the build step runs
Claude Code with a **throwaway `CLAUDE_CONFIG_DIR`** whose `skills/` and `hooks/` symlink into
the **build worktree**, so the self-build exercises *its own edited harness* while the global
`~/.claude/skills` used by concurrent operator sessions is never touched. Torn down after the
build; the global symlinks are left exactly as found. `CLAUDE_CONFIG_DIR` is **not read anywhere
today** — this feature introduces its use. Attaches at the build step
(`engine/steps.ts` `DefaultStepRunner`).

### 4. `VersionApprovalGate` — HALT for the semver bump (finish plane)
Before a harness self-build opens its PR, this gate checks for an operator **VERSION-bump
approval marker**. Absent → `writeHalt()` (`engine/rebase.ts:316`) parks the build asking the
operator to record the approved bump; the operator records it and resumes. This makes
`CLAUDE.md`'s "present the VERSION bump for approval" rule enforceable in `auto` mode instead of
silently skipped.

### 5. `ReleaseArtifactGate` — HALT on release-invariant failure (finish plane)
At finish, for a harness self-build, runs `test/test_harness_integrity.sh` (exit-code contract)
and asserts (a) `CHANGELOG.md` `## [Unreleased]` is non-empty and (b) a `## Migration` block is
present when the change is breaking. Any failure → `writeHalt()` naming the failing gate. Passing
all three still ends in the standard finish-time HALT for the operator to re-install, run
`/verify`, and merge — the daemon never merges.

### Configuration (`HarnessConfig`, `types/config.ts`)
A new optional config block (sibling to the existing `otel` / owner-gate keys at
`types/config.ts:222`) carrying: the self-host activation override (auto / force-on / force-off)
and per-gate knobs (e.g. enable/disable the version and release-artifact gates). Validated in the
existing `validateConfig()` path. Absent config → auto-detect, all gates on — the safe default.

### Control flow (from the architecture diagram)
```
daemon → SelfHostDetector
  ├─ not harness ──→ normal build path (UNCHANGED)
  └─ harness ─────→ SkillRelinkPreflight → SandboxBuildEnv → build step
                    → VersionApprovalGate → ReleaseArtifactGate → finish step
                    (any gate that cannot self-satisfy → writeHalt → operator)
```

## Scope

### In Scope
- **`SelfHostDetector`**: harness-root detection via `resolveHarnessRoot()`, with a config
  override, modeled as a swappable identity seam.
- **`SkillRelinkPreflight`**: extend `ensureInstallFresh` to relink skills before a self-build.
- **`SandboxBuildEnv`**: throwaway `CLAUDE_CONFIG_DIR` with worktree-linked skills/hooks; correct
  isolation (no leak into global `~/.claude`) and guaranteed teardown.
- **`VersionApprovalGate`**: HALT-based VERSION-bump approval before self-build PR.
- **`ReleaseArtifactGate`**: HALT-based integrity-suite + `CHANGELOG [Unreleased]` + migration-block
  checks at finish.
- **`HarnessConfig` extension**: activation override + gate config, validated in `validateConfig()`.
- Distinct HALT reasons per gate so the operator sees *why* a self-build parked.
- Stories with mandatory negative paths (leak attempt, missing approval marker, integrity failure,
  stale skills, detector false-positive/false-negative).

### Out of Scope
- **Autonomous merge of harness self-builds.** The operator merges; ADR-005/ADR-010 preserved.
- **The management plane** (start/stop/watch/debug/restart a daemon) — companion spec
  `2026-06-29-daemon-supervised-hosting.md`, already Approved.
- **Owner-gating** — separate, merged feature (PR #175). Self-host mode composes with it; it is
  not modified here.
- **Building the EKS platform-identity implementation** of the detector seam. The seam is kept
  swappable (design requirement); the platform identity itself is future work.
- **Any change to the normal (non-harness) build path.** Zero behavioral change for other repos.
- **New install mechanism** — reuse `bin/install` and the existing `InstallRunner` seam.
- **Registering the harness in the daemon registry.** This feature makes it *safe* to register;
  the operator decides when to actually do so.

## Key Decisions

1. **One detection seam, many guardrails.** A single `SelfHostDetector` gates the whole bundle so
   there is exactly one place that answers "is this the harness?" — avoiding scattered ad-hoc
   `repo == harnessRoot` checks and giving the EKS identity swap a single attach point.
2. **Every guardrail is HALT-based, never a prompt.** In `auto` mode there is no human to answer a
   prompt; a guardrail that cannot self-satisfy parks the build. This is the only way to honor
   ADR-005's human-merge invariant inside an autonomous loop.
3. **Sandbox isolation over "just be careful."** A throwaway `CLAUDE_CONFIG_DIR` is the mechanism
   that makes "edit the harness while running the harness" safe. Isolation correctness is
   safety-critical (a leak corrupts ~20 live sessions), so it is a built primitive with an explicit
   no-leak/teardown contract and adversarial tests — not a convention.
4. **Detector is a swappable seam, mirroring `IdentityResolver`.** Path comparison now; platform
   identity later, with no change to guardrail behavior — consistent with the harness-wide
   "design for isolated EKS, not local" rule and the owner-gate precedent.
5. **Reuse, don't reinvent.** `resolveHarnessRoot`, `ensureInstallFresh`/`InstallRunner`,
   `writeHalt`, `validateConfig`, and `test_harness_integrity.sh` all exist and are reused. No new
   install path, no new HALT primitive, no new config loader.
6. **Extend the build/finish steps, don't fork them.** Guardrails attach to the existing
   `DefaultStepRunner` build step and the conductor finish step; the non-harness path is untouched.

## Scope Check (design vs. original request)

Compared against the source artifacts — the architecture diagram
(`2026-06-30-harness-self-host-guardrails.md`), the complexity note (Tier L), and the technical
track marker:

- **Component-for-component match.** The design delivers exactly the five `[NEW]` components in the
  architecture diagram (`SelfHostDetector`, `SkillRelinkPreflight`, `SandboxBuildEnv`,
  `VersionApprovalGate`, `ReleaseArtifactGate`) plus the `HarnessConfig` extension the diagram and
  complexity note both call out. No component added, none dropped.
- **Signals covered.** Every complexity signal (cross-cutting seam, novel isolation, config schema
  change, multiple human-park gates, broad surface, state-machine impact) maps to an in-scope item.
- **No scope expansion detected.** The design does **not** register the harness, build the EKS
  identity, touch owner-gating, or alter the normal build path — all explicitly Out of Scope. The
  one framing choice worth surfacing: I describe the detector as a *swappable seam* (not just a path
  check). This is faithful to the architecture doc's own Legend ("a swappable seam so platform
  identity (isolated EKS) can replace path comparison later") and the harness-wide EKS rule — it is
  a **design constraint carried forward, not new scope**. Flagged here for transparency.

**Verdict: in scope. No expansion.** ⚠️ One item flagged above for operator confirmation (detector
framed as a seam), consistent with the source architecture doc.

## Next in DECIDE (technical track, Tier L)
architecture-review (full, ADRs) → stories (happy + negative paths) → conflict-check → plan.

## Change Log
| Date | Change | Reason |
|------|--------|--------|
| 2026-06-30 | Initial draft | /brainstorm design doc during /engineer DECIDE, grounded on confirmed conductor seams |
