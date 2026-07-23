# Architecture Review: Relocate pipeline run-state to a home-dir store (#564)

**Date:** 2026-07-21
**Track:** technical · **Complexity tier:** L (full review)
**Input reviewed:** explore output + `.docs/track/…`, `.docs/complexity/…`,
`.docs/architecture/pipeline-run-state-lives-inside-the-worktree-cwd-r.md` (+ sequences).
Stories and plan do not exist yet (architecture-before-stories).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Fully buildable in-stack (Node fs + git). No new deps. The persistence primitives (`state.ts`, `gate-verdicts.ts`, `halt-marker.ts`, `task-evidence.ts`) already take a resolved path — only callers change. VERIFIED ~95%. |
| **Prerequisites** | A one-time migration for in-flight worktrees whose `.pipeline` is still a real dir (move → store, replace with symlink). No external setup. |
| **Integration surface** | Concentrated: 3 cwd seams (`index.ts:605-609`, `daemon-cli.ts:760`, `session-hook-assets.ts:92/256`) + the resolver's consumers (`resume.ts`, `auto-resume.ts`, `finish-record-cli.ts`, `daemon-dashboard.ts:244`). The ~15 per-artifact modules keep their `(path)`/`(dir)` signatures. |
| **Data implications** | No DB. Filesystem relocation + symlink; migration must be loss-free. |
| **Performance risk** | Negligible — one extra `projectKey` (cached-able sha256 + one `git remote get-url`) per run resolve; memory store already pays this. |
| **Worktree isolation** | Improves it: state moves OUT of the worktree, keyed by projectKey+slug; two worktrees can never collide on state. |

## Complexity

Tier **L** (per `/conduct`, recorded in `.docs/complexity/…`). New shared abstraction + outward-symlink
durability contract + migration + broad-but-shallow caller rewiring + exec-time hook coupling.

## Alignment

- **Convention over precedent.** Directly reuses the APPROVED memory-store placement pattern
  (`adr-2026-06-29-shared-memory-store-placement-and-durability`): `projectKey()`, outward symlink,
  write-through-the-store. Consistent with the #486 park-marker principle "address by identity, not
  cwd." No documented decision is violated.
- **Divergence from the memory store (intentional, ADR'd):** memory is project-keyed and *shared*;
  run-state is project-keyed **and slug-keyed** and *not shared* — per-feature isolation is the whole
  point. Captured in `adr-2026-07-21-run-state-home-dir-placement`.
- **State management.** Feature identity becomes an explicit value object `{projectKey, slug}` rather
  than an implicit cwd-derived path — invalid ("which .pipeline?") states become unrepresentable.
- **Diagram accuracy.** `.docs/architecture/…` before/after + sequences match this decision.
- **Security boundaries.** No new endpoints/inputs. `projectKey` is a sha256 hash; slug is
  `slugify`-sanitized (`[^a-z0-9-]` stripped) — path-traversal-safe, same as the memory store's
  validated entry paths.

## Domain Integrity

- **No primitive obsession / semantic types.** `FeatureIdentity {projectKey, slug}` parsed once at the
  boundary; the resolver consumes the type, not raw strings. **Parse-don't-validate**: identity is
  constructed (and validated) at the seam, trusted thereafter.
- **Invalid states unrepresentable.** A run-state dir cannot be addressed without a resolved identity;
  there is no cwd fallback (fail-closed) — so "state at an ambiguous root" cannot occur.
- **Exhaustive matching.** Identity resolution has explicit branches (featureDesc present / worktree
  basename / neither→error); no silent catch-all default to cwd.

## Wiring Surface (design-time)

| New/changed production surface | Where it is called from in production |
|---|---|
| `run-state-store.ts` → `aiConductorHome()` | Internal base for `resolveRunStateDir`; later the shared base for other `~/.ai-conductor` joins (follow-up). |
| `resolveRunStateDir(identity)` | The `conduct` host (`index.ts`, replacing the `:605-609` cwd seed + the resume reassignment sites); the daemon per-worktree dispatch (`daemon-cli.ts`, replacing `:760`); `resume.ts` / `auto-resume.ts`; `finish-record-cli.ts`; `daemon-dashboard.ts` status read. |
| `ensureRunStateStore(worktreePath, identity)` | Invoked at run start on both the host seed path and the daemon per-worktree setup, right where `mkdir(pipelineDir)` is called today. |
| `migrateInTreePipelineIfPresent(worktreePath, identity)` | Called from inside `ensureRunStateStore` on first resolve. |
| `removeRunStateDir(identity)` | Wired into feature teardown / `finish` end-of-feature cleanup. |
| Generated hook scripts (`session-hook-assets.ts`) | The generator injects the resolved absolute store path; scripts run by the Claude subprocess in the worktree stop using `process.cwd()`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A run-state write path has no resolvable feature identity → resolver can't key it | Technical | Low | High | **Fail-closed**: resolver raises, never falls back to cwd. Plan enumerates every write entry point and proves an identity at each (Condition 1). |
| In-flight worktree migration strands or loses state | Data | Medium | High | Reuse tested memory-store real-dir→migrate shape; loss-free move + symlink; dedicated migration regression test (Condition 2). |
| Generated hook scripts keep resolving `.pipeline` by cwd | Technical | Medium | Medium | Inject resolved absolute store path at generation time; assert no `process.cwd()` remains in emitted hook source (Condition 3). |
| Two concurrent features collide on state | Data | Low | High | projectKey+slug namespacing → disjoint dirs; per-slug cleanup. Regression test with two concurrent slugs. |
| Slug truncation collision within one project | Data | Low | Medium | Pre-existing invariant — worktrees + park markers already key on the same slug; not worsened by this change. Noted, not gated. |

## ADRs Created

- `adr-2026-07-21-run-state-home-dir-placement` (**DRAFT** → must reach APPROVED before
  `/writing-system-tests`). Category: Infrastructure (state storage location) + Cross-Cutting
  Concern (canonical resolver).

## Conditions (APPROVED WITH CONDITIONS)

1. **Fail-closed identity.** The plan must enumerate every run-state write entry point and prove a
   `FeatureIdentity` is resolvable at each; any path lacking one raises an explicit error and MUST
   NOT fall back to a cwd-relative path.
2. **Loss-free migration.** In-flight worktrees with a real `.pipeline` dir must migrate without loss,
   covered by a regression test.
3. **No residual cwd in hooks.** Generated session-hook scripts must resolve the store by injected
   path, with a test asserting no `process.cwd()`-based `.pipeline` resolution remains.
4. **Durability + isolation tests.** Acceptance coverage for: run resumes after worktree removal;
   run resumes after a cwd-relative `.pipeline` delete; two concurrent features keep disjoint state;
   per-slug cleanup removes exactly one feature's state.
