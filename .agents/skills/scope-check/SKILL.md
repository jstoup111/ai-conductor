---
name: scope-check
disable-model-invocation: true
description: "Use before authoring any change to the ai-conductor harness repository, and before creating any new skill, to decide three things deterministically: whether the change is harness-repo-only or consumer-facing, whether a new skill belongs in the shipped `skills/` catalog or this repository's local `.agents/skills/` catalog, and whether the change is provider-agnostic. Produces a placement verdict and the registration steps that verdict requires."
---

# Scope Check

Three scope questions recur on every change to this repository, and each has a cheap wrong answer
that is expensive to unwind. Run the decision procedures below **before** authoring, not after.

This repository is the harness. It authors skills, agents, an engine (`src/conductor`), and
behavioral rules that get installed into *other* repositories — "consumer repositories" — which then
use the harness to build their own software. It also builds *itself* with itself (self-host). Those
two audiences share a checkout, which is exactly why scope errors are easy to make here and nowhere
else.

Answer A, then B, then C. B is only reached when the change adds a skill. C applies to every change.

---

## 1. Decision A — harness-repo-only, or consumer-facing?

**Question:** does this change serve *this repository's own construction*, or *every repository that
installs the harness*?

### Procedure

Walk the signals in order. The first HALT wins; a signal that does not fire is not evidence for the
other side.

**Step 1 — repo-only signals.** Answer YES to any of these and the change is **harness-repo-only**:

1. It touches self-host, daemon, or sandbox machinery — anything under
   `src/conductor/src/engine/self-host/`, the live-boundary fingerprint, the isolated provider home,
   or a code path gated behind `isSelfBuild()`. That gate is the canonical shape of a repo-only
   feature: it is `daemon && selfHost`, so every other repository's bytes are unchanged.
2. It touches this repository's own validation or release gates — `test/test_harness_integrity.sh`,
   `test/lint_shell.sh`, `test/test_provider_skill_contracts.sh`, `bin/generate-model-table`, the
   release-gate classifier, `.docs/release-waivers/`.
3. It touches this repository's own CI (`.github/workflows/`) or its `.ai-conductor/config.yml`
   custom steps.
4. It depends on a convention only this repository has — its `.docs/` layout, its `[Unreleased]`
   changelog gate, its `VERSION` file, its shipped-record ledger, its own branch policy.

**Step 2 — consumer signals.** If no repo-only signal fired, answer this:

> Would a repository that installed the harness, has **no** daemon, has **no** `.docs/` history, and
> has never run a self-host build still benefit from this change?

- **YES** → **consumer-facing.**
- **NO** → **harness-repo-only.**

This question is a general-benefit heuristic and over-generalizes a change whose subject is a
mechanism that exists only here — ask first whether that mechanism exists outside this repository.
See the caveat under `AGENT_INSTRUCTIONS.md` → **Scope Decisions**: this skill's verdict is an input,
not the decision, and a conflict with the operator's plain request is surfaced before landing.

**Step 3 — mixed changes are split, never averaged.** A change that fires both a repo-only signal
and the consumer question is two changes. Land the consumer-facing behavior in the shared surface
and the repo-only behavior in the repo-local surface, and say so in the diff. Do not ship a shared
rule with a repo-only escape clause buried in it.

### Where the artifact goes

| Verdict | Rules go in | Docs go in | Skill catalog |
| --- | --- | --- | --- |
| Consumer-facing | `HARNESS.md` | `docs/` (`reference/`, `guides/`, `explanation/`, `runbooks/`) | `skills/` |
| Harness-repo-only | `AGENT_INSTRUCTIONS.md` (the file `CLAUDE.md` and `AGENTS.md` both point at) | `docs/guides/self-hosting.md`, `docs/contributing/` | `.agents/skills/` |

`HARNESS.md` is the single source of truth for behavioral rules *consumed by* projects using the
harness. `AGENT_INSTRUCTIONS.md` describes how *this* repository is built. A rule written into the
wrong one is either invisible to consumers or imposed on them without cause.

### Follow the existing precedent

This repository already states the boundary explicitly, in a fixed sentence shape, wherever a rule is
deliberately repo-only. Both instances live in `AGENT_INSTRUCTIONS.md` — the documentation-upkeep
rule and the changelog rule — and both end:

> "For consumer projects without this custom-step configuration, the global harness … convention
> remains unchanged."

When Decision A returns **harness-repo-only** for a rule that *narrows or replaces* a shared
convention, write that sentence. It is the established contract, and omitting it is what makes a
reader assume a repo-local rule is universal. When the repo-only rule is purely additive — a new
gate consumers have no analogue for — no such sentence is needed, because there is no shared
convention being narrowed.

### Cost of getting A wrong

- **Repo-only shipped as consumer-facing.** Every consumer repository inherits machinery it has no
  daemon, no `.docs/` ledger, and no self-host build to satisfy. The failure is not loud — it is a
  gate that can never pass in a repository that was never supposed to run it, and the operator there
  has no context to diagnose why.
- **Consumer-facing buried as repo-only.** A genuinely universal capability is trapped behind this
  repository's private conventions. It never installs, never appears in the shipped catalog, and the
  next author re-implements it — badly — because the existing one looked repo-specific.

---

## 2. Decision B — shipped `skills/`, or local `.agents/skills/`?

Reached only when the change adds a skill. There are exactly two catalogs.

| | `skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |
| --- | --- | --- |
| Audience | every repository that installs the harness | this repository only |
| Installed by | `bin/install`, which auto-discovers every `skills/<name>/` containing a `SKILL.md` | nothing — never installed anywhere |
| Discovery homes | both user-space catalogs: `~/.claude/skills` and `~/.agents/skills` | in-repo only: `.agents/skills/` natively, plus a `.claude/skills/<name>` symlink |
| Current members | the shipped lifecycle catalog | `maintain-documentation`, `write-tests`, `scope-check` |

### Procedure

1. **Would a consumer repository ever invoke it?** If NO → `.agents/skills/`. Stop.
2. **Does it encode conventions only this repository has** — its validation suite, its release gates,
   its `.docs/` layout, its self-host build, its own test-isolation policy? If YES → `.agents/skills/`.
   Stop.
3. **Is it a lifecycle capability** — something that belongs to a phase of building software in *any*
   repository (understand, decide, build, ship)? If YES → `skills/`.
4. **Still ambiguous?** Default to `.agents/skills/`. Promoting a local skill to the shipped catalog
   later is additive and reversible; demoting a shipped skill breaks every installation that already
   symlinked it.

### The registration asymmetry — why B is load-bearing

The two catalogs cost radically different amounts to join, because this repository's integrity suite
globs `skills/*/SKILL.md` and nothing else.

A **`skills/` addition** must satisfy all of:

- Frontmatter with all four required fields — `name`, `description`, `enforcement`, `phase`
  (integrity check 2).
- A row in `HARNESS.md`'s model-selection table (check 5). That region is **generated**: its source
  is `src/conductor/src/engine/model-table-metadata.ts` plus the resolved config, rendered by
  `bin/generate-model-table`. Hand-editing `HARNESS.md` fails check 5a's drift gate — the fix is to
  update the metadata and regenerate.
- Agreement between the model table's tier and the skill's own `model:` pin, in both directions
  (check 5b).
- Every `` `/skill-name` `` reference it makes must resolve to a real `skills/` directory (check 4).
- The provider contract audit in `test/test_provider_skill_contracts.sh`, which is mechanically
  hostile to Claude-only phrasing (see Decision C).
- Automatic symlinking into both user-space catalogs on the next `bin/install`, for every consumer.

A **`.agents/skills/` addition** requires none of the shipped catalog's model-table registration.
Its frontmatter is deliberately minimal — `name`, `description`, and the Claude invocation-policy
field only; no `enforcement`, no `phase`, no `model` — and `docs/reference/skills.md` states that
exclusion in so many words. Integrity check 2a still includes the local catalog so invocation policy
cannot drift between hosts.

Two consequences follow, and both matter:

- The catalog choice is a real fork, not a filing preference. One path drags six gates and a global
  install; the other drags none.
- The local catalog remains outside the broader provider-language audit, so provider-agnosticism is
  still a human obligation beyond the mechanically checked invocation policy. Decision C is therefore
  *more* important for a local skill, not less.

### What a local skill still owes

1. `.agents/skills/<name>/SKILL.md` — frontmatter of `name`, `description`, and
   `disable-model-invocation: true`; local skills are explicit-only by default.
2. `.agents/skills/<name>/agents/openai.yaml` — the Codex-side interface block, matching the existing
   local skills: `interface:` with `display_name`, `short_description`, and `default_prompt`, plus
   `policy.allow_implicit_invocation: false` for parity with Claude.
3. A symlink `.claude/skills/<name> → ../../.agents/skills/<name>`, committed as a git symlink (mode
   `120000`), so the skill is discoverable from the other supported host too. This is the local
   catalog's provider-parity mechanism — see Decision C.
4. An entry in `docs/reference/skills.md` under **Repository-local skills**, plus its two counts at
   the top of that file.
5. If it is wired as an engine step, a `steps:` entry in `.ai-conductor/config.yml` pointing at its
   `.agents/skills/<name>/SKILL.md` path. Operator-invoked local skills need no wiring.

### Worked example — this skill

`scope-check` runs Decision B on itself.

- Step 1: would a consumer repository ever invoke it? **No.** Its entire subject is the boundary
  between this repository and its consumers, the two catalogs *this* repository maintains, and the
  registration gates *this* repository enforces. A repository that merely installs the harness has
  one catalog, no model-selection table to regenerate, and no consumer of its own.
- Verdict: `.agents/skills/scope-check/SKILL.md`.

Placing it in `skills/` would ship a skill about this repository's private authoring decisions into
every consumer's user-space catalog, where its advice is not merely useless but actively wrong —
telling an operator to weigh a `HARNESS.md`-versus-`AGENT_INSTRUCTIONS.md` split that does not exist
in their repository. That is precisely the error Decision A exists to prevent, committed by the
artifact meant to prevent it. It is recorded here as the worked example on purpose.

### Cost of getting B wrong

- **Local skill filed as shipped.** It installs into every consumer's `~/.claude/skills` and
  `~/.agents/skills` on their next update, where a host agent can match its `description` and invoke
  it against a repository whose layout it describes incorrectly. Removing it later is a breaking
  change to installed state, not a revert.
- **Shipped skill filed as local.** It never installs anywhere. No consumer can reach it, it gets no
  model-table row, no `enforcement`/`phase` declaration, and no provider audit — so it silently
  accumulates provider-specific assumptions until promotion becomes a rewrite.

---

## 3. Decision C — is it provider-agnostic?

Every supported host must be able to do the thing. Nothing may work only on Claude or only on Codex.

### Procedure

Answer each. Any YES in steps 1–3 requires the remedy in step 4 before the change lands.

1. **Does it name a provider-specific path, environment variable, config file, or CLI flag?**
   Examples that are provider-specific: `~/.claude/skills`, `~/.agents/skills`, `CLAUDE_CONFIG_DIR`,
   `CODEX_HOME`, `.claude/settings.local.json`, `.claude/skills/`. Naming one is allowed; *relying*
   on one without its counterpart is not.
2. **Does it rely on a capability only one provider has?** Interactive slash commands, a specific
   one host's subagent facility, a model-selection parameter, a settings key one host reads and the
   other ignores.
3. **Is there an equivalent seam on the other side?** If a seam exists, use both. If no seam exists,
   the capability is genuinely unsupported on that host and must fail closed with a diagnostic that
   names the selected provider and a recovery action — `HARNESS.md`'s unsupported-capability contract,
   which `test/test_provider_skill_contracts.sh` asserts. It must not silently degrade.
4. **Remedy — scope, don't remove.** Provider mechanics stay; they get an explicit owner on the same
   line. The house pattern, which the audit's own fixtures encode:

   > Claude Code invokes `conduct` as `/conduct`; Codex invokes it as `$conduct`.

   > Claude Code uses its Agent tool with a model parameter; other hosts use the selected host's
   > available subagent facility.

   The shared outcome and the shared gate are stated once, provider-neutrally, and only the
   invocation mechanics fork.

### What is already mechanized — point at it, do not restate it

- `test/test_provider_skill_contracts.sh` runs in the integrity suite. It does two things: it
  pins required provider-neutral language in `HARNESS.md` and in the shipped skills, and it runs a
  deterministic audit that rejects the specific ways an instruction accidentally becomes Claude-only
  — an unscoped imperative slash command, an unscoped reference to Claude Code's Agent tool, an
  unscoped model
  parameter, unscoped Claude-subagent delegation, an unscoped interactive slash command. It also
  carries fixtures proving each category fails for the right reason. Read it before writing new
  prose about provider neutrality; it is the specification.
- **Root instruction parity is structural, not editorial.** `CLAUDE.md` and `AGENTS.md` are both
  symlinks to `AGENT_INSTRUCTIONS.md`, and integrity check 15 asserts exactly that. Claude reads
  `CLAUDE.md`, Codex reads `AGENTS.md`; because both resolve to one file, a change to this
  repository's agent instructions reaches both hosts by construction. **Never break that by
  converting either into a regular file to hold host-specific text** — that is what makes them drift,
  and it is the failure check 15 exists to catch. Host-specific guidance goes *inside* the shared
  file, scoped on the line.
- **The local catalog's parity mechanism is the symlink pair.** `.agents/skills/` is already Codex's
  native project-local location; the committed `.claude/skills/<name>` symlink makes the identical
  file reachable from Claude. One file, two discovery paths — the same construction as the root
  instructions. A local skill that exists in only one of the two is reachable by only one host.

### Real asymmetries this decision must catch

These are live in this repository. They are the shape of the trap, not hypotheticals.

- **Discovery and invocation are separate host seams.** `bin/install` enumerates `skills/*/`
  containing a `SKILL.md` and symlinks the identical set into `~/.claude/skills` and
  `~/.agents/skills`; it has no per-provider catalog filter. Invocation control is paired instead:
  Claude reads `disable-model-invocation: true` from `SKILL.md`, while Codex reads
  `policy.allow_implicit_invocation: false` from `agents/openai.yaml`. Adding only one side recreates
  the exact provider-parity failure Decision C exists to prevent. Engine-rendered `/skill` or `$skill`
  prompts remain explicit and continue to work.
- **`.claude/settings.local.json` has no Codex counterpart.** That file carries a `permissions.allow[]`
  array that Claude reads and Codex does not. Anything whose behavior depends on it — an allowed
  command, a suppressed prompt — is Claude-only by construction, and will appear to work because the
  operator tested it on Claude. Behavior that both hosts must share cannot live in one host's
  settings file.
- **The isolated provider home — a correct seam, and a real provider difference inside it.**
  `src/conductor/src/engine/self-host/provider-home.ts` provisions a throwaway home and sets
  `CLAUDE_CONFIG_DIR` for Claude or `CODEX_HOME` for Codex from a single `HOME_VARIABLE` map. That is
  the shape to imitate: one seam, both sides named, and gated behind `isSelfBuild()` — literally
  `daemon && selfHost` in `src/conductor/src/engine/conductor.ts` — so every other repository's build
  path is byte-for-byte unchanged. Note what the file had to absorb to stay symmetric: it **copies**
  `skills/` rather than symlinking it, because Codex's skill discovery writes `.system/` bookkeeping
  back through a live link into the git-tracked worktree; and it creates a Codex-only
  `<home>/.agents/skills → <home>/skills` link, because Codex discovers by that directory name while
  Claude reads its config dir. Claude's parallel path is a different file entirely
  (`self-host/sandbox-build-env.ts`, which symlinks). Same outcome, two mechanisms, both explicit —
  that is what "provider-agnostic" means in practice. It does not mean identical code.
- **Ambient credentials are not symmetric.** The same provisioning path deletes
  `CLAUDE_CODE_OAUTH_TOKEN` from the child environment. It is a Claude-side variable with no Codex
  equivalent; assuming a token variable exists on both sides is the same class of error in reverse.
- **`~/.codex/skills` is a legacy Codex location; `~/.agents/skills` is the active one.** Installation
  cleans up the former. A change that writes only one of the two user-space catalogs halves the
  corpus for one host, and duplicate discovery across the legacy and active Codex directories is an
  install failure, not a warning.

### Cost of getting C wrong

The change works — for the operator who wrote it, on the provider they happened to be running. It
fails for the other host at a time and place with no connection to the commit that caused it: a skill
that never triggers, an override that never applies, a catalog that is half-populated. Provider
asymmetry does not produce errors; it produces absence, which is far harder to trace.

---

## 4. Output

Emit the three verdicts explicitly before authoring, and carry them into the change description:

```
Scope check
  A. Audience:  harness-repo-only | consumer-facing   — <the signal that decided it>
  B. Catalog:   skills/ | .agents/skills/ | n/a       — <the step that decided it>
  C. Provider:  agnostic | scoped-with-both-seams | unsupported-and-fails-closed
  Registration: <the list this verdict requires, from §1 and §2>
```

If A and B disagree — a consumer-facing rule paired with a local skill, or vice versa — that is not
a nuance to reconcile in prose. Re-run A; one of the two answers is wrong.

---

## Verification

- [ ] Decision A run, with the specific signal that decided it named — not "feels repo-specific"
- [ ] Rules landed in `HARNESS.md` (consumer-facing) or `AGENT_INSTRUCTIONS.md` (repo-only), never both by copy
- [ ] A repo-only rule that narrows a shared convention carries the established
      "For consumer projects … remains unchanged" sentence
- [ ] Mixed-scope change split into its consumer-facing and repo-only halves, not averaged into one rule
- [ ] Decision B run for every new skill, with its deciding step named
- [ ] A `skills/` addition declares `name`, `description`, `enforcement`, `phase`
- [ ] A `skills/` addition is registered via `src/conductor/src/engine/model-table-metadata.ts` and
      `bin/generate-model-table` — `HARNESS.md`'s generated table is **not** hand-edited
- [ ] A `.agents/skills/` addition declares `name`, `description`, and
      `disable-model-invocation: true`, and adds no other fields the local catalog does not use
- [ ] A `.agents/skills/` addition ships its `agents/openai.yaml` interface block with
      `policy.allow_implicit_invocation: false` and a committed
      `.claude/skills/<name>` symlink (git mode `120000`)
- [ ] Decision C run; every provider-specific path, variable, or capability either has its
      counterpart or is scoped to its host on the same line
- [ ] `CLAUDE.md` and `AGENTS.md` remain symlinks to `AGENT_INSTRUCTIONS.md` — no host-specific text
      was added by splitting them
- [ ] `docs/reference/skills.md` updated: the new skill's entry and the counts at the top of the file
- [ ] Documentation upkeep satisfied per this repository's rule — the canonical affected page updated
      in the same change
- [ ] Changelog decision made deliberately: an entry under `[Unreleased]` only for a notable
      reader-visible implementation change
- [ ] `test/test_harness_integrity.sh` passes, including check 5a (model-table drift), check 15
      (root instruction parity), and the provider skill contract suite
