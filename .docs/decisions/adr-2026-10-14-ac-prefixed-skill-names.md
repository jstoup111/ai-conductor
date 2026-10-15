# ADR: Harness skills install and dispatch under `ac-` prefixed names

**Date:** 2026-10-14
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE session for #885

## Context

Every shipped skill installs into host-wide catalogs under its bare directory name:
`bin/install` links `skills/<dir>` as `~/.claude/skills/<dir>` (Claude) and `~/.agents/skills/<dir>`
(Codex, Pi). Those catalogs are shared with personal skills, third-party packs and host built-ins.
Two collisions are live today: harness `code-review` and `simplify` replace Claude Code built-ins of
the same name, and a foreign same-named entry makes install skip the harness skill. The engine
renders invocations as provider prefix + skill name (`/`, `$`, `/skill:` in `provider-catalog.ts`),
and self-host builds copy the worktree `skills/` tree as the sandbox catalog
(`self-host/provider-home.ts`). Hosts derive a skill's invocation name from frontmatter `name:`
(Pi verified; Claude Code documented), not from the link name.

## Options Considered

### Option A: install-time `ac-` prefix, source directories unchanged
- **Pros:** works identically on Claude, Codex and Pi; no directory renames (no two-feature split, no
  testQuality materialization hazard); repo paths stay stable for path-based loads.
- **Cons:** source directory name differs from invocation name; every name consumer must derive it.

### Option B: Claude plugin namespace (`ai-conductor:plan`)
- **Pros:** real host namespacing with no renames.
- **Cons:** Claude only — Codex and Pi have no namespace; plugin installs are cached copies, breaking
  live-checkout relinking; colon is forbidden in `name:` so it cannot be emulated elsewhere.

### Option C: rename source directories to `skills/ac-<dir>/`
- **Pros:** directory, link and name identical.
- **Cons:** 35 directory renames trigger the repository's two-feature deletion split and the #1961
  materialization hazard, and churn every path-based skill load.

### Option D: A plus one-release bare-name aliases
- **Pros:** grace period for operators and consumer prose.
- **Cons:** symlink aliases cannot work (hosts read frontmatter `name:`; Pi dedups links to the same
  file); generated stub aliases keep the bare names occupied and need ownership and retirement
  machinery.

## Decision

Option A, without aliases, delivered in two sequenced specs.

1. **One naming rule, declared in frontmatter.** A shipped skill whose source directory is
   `skills/<dir>/` has the installed and invoked name `ac-<dir>`, declared as its frontmatter `name:`.
   Source directories keep their bare names. The frontmatter `name:` is the single authority every
   consumer reads; the integrity suite enforces that it equals `ac-<dir>`.
2. **The engine reads names from the tree it dispatches into.** Every engine site that renders,
   matches or keys a host-visible skill name resolves it from the frontmatter `name:` of
   `skills/<dir>/SKILL.md` in the skill tree that dispatch uses — the feature worktree for a self-host
   dispatch, the installed harness root otherwise — falling back to `<dir>` when `name:` is absent.
   Sites that load a skill file by path keep `skills/<dir>/SKILL.md`. The engine never computes the
   prefix itself, so a running engine stays consistent with whatever names the catalog it dispatches
   into declares.
3. **Every catalog the harness builds is keyed by frontmatter name.** The self-host provider home
   copies each skill under its frontmatter name, the Claude self-host sandbox exposes one link per
   skill under its frontmatter name into the build worktree's `skills/<dir>` (replacing the whole-tree
   `skills` link of `adr-2026-06-30-sandbox-build-isolation` D1; the set of entries is fixed when the
   sandbox is provisioned, while each entry still reflects in-build edits to that skill's files), the
   live-tier preflight looks step commands up by frontmatter name, and `bin/install` links each skill
   under its frontmatter name into both host catalogs, so no host relies on frontmatter overriding a
   mismatched directory name. Built-in step names resolve from the engine's own harness root (the
   module-relative root), or from the feature worktree for self-host dispatch; custom and
   `parallel[].skill` steps keep their existing resolution.
4. **No aliases; harness-owned bare links are reconciled.** Install removes a catalog link only when its
   target resolves inside the prior harness root's `skills/` and the link name is not a current
   installed name. Foreign entries are never modified or removed.
5. **Collisions fail loudly.** When a foreign entry occupies an installed name, install leaves it
   untouched, reports every such collision in a final summary, and exits non-zero.
6. **Internal references use installed names and are enforced.** Every `/<name>` skill reference in
   shipped skills and harness docs uses the `ac-` name, and the integrity suite fails any shipped skill
   reference that does not resolve to an installed name. Consumers receive a `## Migration` block that
   reruns install and lists the renames.
7. **Two sequenced specs.** Self-host builds run an engine built from `main` against a copy of the
   feature worktree's `skills/`, so flipping names in the same feature that teaches the engine to read
   them would break that feature's own dispatches. Spec 1 (`namespace-harness-skill-and-agent-names-so-they-ca`)
   delivers Decisions 2 and 3 with every frontmatter `name:` still equal to `<dir>`, so it changes no
   visible name. Spec 2, a follow-up intake blocked on Spec 1 being merged and the daemon running its
   engine, delivers Decisions 1, 4, 5 and 6 and flips every `name:` to `ac-<dir>`.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Pi takes a skill's name from frontmatter `name:` and silently skips a second link to the same file (`pi-coding-agent/dist/core/skills.js` lines 243-245 and 323-325) | verified | 95% | yes | Aliases would be viable again; no effect on the chosen design | n/a |
| A2 | Claude Code takes the command name from frontmatter `name:` when it differs from the directory name | inferred | 75% | no | None: Decision 3 makes link name and `name:` identical in every catalog the harness builds | n/a |
| A5 | A self-host build runs an engine built from `main` (`dist-versions/`) while dispatching into a copy of the feature worktree's `skills/` (`self-host/provider-home.ts`), so a same-feature name flip breaks its own dispatches | inferred | 80% | yes | Splitting would be unnecessary overhead, not incorrect | APPROVED by operator 2026-10-14 |
| A3 | Codex resolves `$ac-<dir>` when the catalog entry and frontmatter `name:` are both `ac-<dir>` | inferred | 90% | yes | Codex dispatch fails; caught by Codex invocation tests | APPROVED by operator 2026-10-14 |
| A4 | No harness skill directory name already begins with `ac-` and no host built-in uses an `ac-` name | verified | 90% | no | A doubled prefix or built-in collision; integrity check would surface it | n/a |

## Consequences

### Positive
- Bare names are freed for host built-ins and foreign skills on every provider.
- One rule, enforced mechanically, replaces ~570 hand-maintained bare references.

### Negative
- Operator muscle memory and consumer prose that say `/plan` break on update with no grace period.
- Directory name and invocation name now differ; contributors must use the rule rather than the
  directory name when naming a skill in prose or dispatch.

### Follow-up Actions
- [ ] Spec 1: implement Decisions 2 and 3 per the plan for `namespace-harness-skill-and-agent-names-so-they-ca`.
- [ ] Spec 2: follow-up intake jstoup111/ai-conductor#3233 delivering Decisions 1, 4, 5 and 6, blocked on Spec 1.
