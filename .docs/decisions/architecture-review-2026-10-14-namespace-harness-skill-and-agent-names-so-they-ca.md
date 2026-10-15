# Architecture Review: Namespace harness skill names (`ac-` prefix) — Spec 1
**Date:** 2026-10-14
**Stories reviewed:** none yet (pre-stories, technical track; input is the explore decision and
`.docs/track/namespace-harness-skill-and-agent-names-so-they-ca.md`)
**Mode:** Lightweight (Medium tier) — §2 Feasibility and §4 Alignment, re-opened in amendment mode
for the self-host buildability gap
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Buildability gap (amendment trigger).** The daemon runs an immutable engine built from `main`
  (`engine-store.ts`, `dist-versions/`), and each self-host dispatch copies the feature worktree's
  `skills/` into a throwaway provider home (`self-host/provider-home.ts`, copy of the `skills` asset).
  Hosts take a skill's invocation name from frontmatter `name:` (Pi verified in
  `pi-coding-agent/dist/core/skills.js`; Claude documented). A single feature that both flips
  `name:` to `ac-<dir>` and teaches the engine the new names would have its later dispatches render
  bare names against an `ac-` catalog. Resolution: the engine reads names from the tree it dispatches
  into, and delivery splits into two specs (ADR Decisions 2 and 7).
- **Resolver placement.** `renderSkillInvocation` (`skill-invocation.ts`) has callers in
  `step-runners.ts` and `project-prelude.ts`; `resolveHarnessRoot()` already locates the installed
  harness for path loads, and self-host dispatch already knows its worktree root. A resolver taking a
  skills root and a directory id fits both without new infrastructure.
- **Stack / prerequisites / data / performance / worktree isolation:** no new dependencies, no
  persisted state keyed by skill names, one small frontmatter read per dispatch, no new shared
  resources.
- **Size estimate:** Spec 1 about 9 tasks; Spec 2 about 9 tasks. Each is under the 20-task threshold.

## Alignment

- **Governing decisions reused:** `adr-2026-06-30-halt-based-release-gates` and
  `adr-2026-07-06-migration-gate-waiver`. Spec 1 changes no symlink target name (frontmatter still
  equals directory), so it needs a waiver for the "skill symlink targets" surface if the release
  classifier flags `bin/install`; Spec 2 carries a real `## Migration` block.
- **New ADR:** `adr-2026-10-14-ac-prefixed-skill-names` — the installed-name contract between the
  harness and host skill catalogs, now with frontmatter as the single authority and a two-spec
  delivery.
- **Pattern consistency:** the provider-neutral invocation pattern (provider prefix + skill name) is
  preserved; only the source of the name changes. Path-based loads keep directory paths.
- **Domain integrity:** directory id and installed name are distinct concepts. Engine code keys tables
  by directory id and converts at the host boundary through one resolver; no call site reads
  frontmatter or concatenates a prefix itself.
- **Out of scope, confirmed:** `agents/*.md`, repo-local `.agents/skills/*`, Claude plugin packaging.
- **Diagram accuracy:** the component diagram reflects the frontmatter resolver and the two-spec
  delivery.
- **Production DI defaults:** not applicable.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Engine skill-name resolver (reads frontmatter `name:` from a skills root) | `renderSkillInvocation` callers in `step-runners.ts` (step dispatch, self-host candidates) and `project-prelude.ts`; `engineer-cli.ts` composer launch; `monitor/session.ts`; `worktree-prepare.ts` operator-only `skillOverrides`; `install-freshness.ts`; `pi-provider.ts` first-token parsing |
| Self-host catalog keyed by frontmatter name | Existing `provider-home.ts` asset copy and `sandbox-build-env.ts` linked dirs, run per self-host dispatch |
| `bin/install` link names read from frontmatter | Existing install loop over `SKILLS` for the Claude and Codex catalogs |
| Live-tier step-command preflight looks up frontmatter names | Existing live daemon E2E tier fixture (`test/fixtures/step-command-preflight.ts`), run before each live dispatch |

Early overlap scan (advisory): `origin/spec/daemon-self-host-guardrails` also touches
`install-freshness.ts` and `self-host/sandbox-build-env.ts`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A dispatch site still uses the directory id as the host name, so Spec 2's flip breaks that site | Integration | Medium | High | One resolver; a fixture skill tree whose frontmatter names differ from directories drives every site's tests in Spec 1 |
| Self-host dispatch resolves names from the installed harness root instead of the worktree copy | Integration | Medium | High | Self-host tests resolve from a worktree fixture whose names differ from the installed root |
| Spec 2 dispatched before the daemon runs the Spec 1 engine | Integration | Low | High | Spec 2 intake is blocked on Spec 1; daemon stale-engine restart picks up the merged engine before dispatch |
| Spec 1 changes visible behavior | Integration | Low | Medium | Every shipped `name:` equals its directory in Spec 1; existing invocation-literal tests stay unchanged and green |

## ADRs Created

- `adr-2026-10-14-ac-prefixed-skill-names` (APPROVED by operator 2026-10-14)

## Conditions

1. Every engine host-visible skill-name site resolves through the single frontmatter resolver; no call
   site reads frontmatter or spells the prefix itself.
2. Self-host dispatch resolves names from the feature worktree's skill tree, and the self-host catalog
   is keyed by those names.
3. Spec 1 changes no shipped frontmatter `name:`, and the Spec 2 follow-up intake is filed with a
   blocking edge on this spec before handoff.
