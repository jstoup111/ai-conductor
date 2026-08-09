# ADR: Bash reaches the `conductor:` block through `conduct-ts config`, never through PyYAML

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** James Stoup (operator), engineer session for intake #1400
**Feature:** update-check config single source of truth (ai-conductor#1400)
**Related:** `adr-2026-08-09-conductor-block-single-source-of-truth.md`,
`adr-2026-08-09-legacy-json-seed-migration-rule.md`,
[#1026](https://github.com/jstoup111/ai-conductor/issues/1026) (a malformed user config blocks every
project on the machine)

## Context

`adr-2026-08-09-conductor-block-single-source-of-truth.md` moves update-check state into a YAML file
that `bin/update`, `bin/install`, and `bin/conduct` must read and write from bash.

The obvious mechanism is the existing `harness_cfg_get` / `harness_cfg_set`
(`bin/lib/harness-common.sh:73,111`), which shell out to `python3` + PyYAML. **That mechanism is
unsafe for this particular flow**, and the reason is specific:

- `harness_cfg_get` **silently returns the caller's default** when PyYAML is unimportable
  (`harness-common.sh:79-82` catches the `import yaml` failure, prints `$DEFAULT`, and exits 0).
- PyYAML is not a guaranteed dependency. `harness-common.sh:9` calls it "optionally" required;
  `bin/install` only warns and continues when even `python3` is missing (`:345,410,943,963`);
  no installation prerequisite documents it.
- Chained together: a PyYAML-less install would read `current_version=""`, and
  `bin/update:133-138` treats a non-semver `current_version` as unverifiable and stops checking.
  Because `bin/update --auto` is spawned advisory-only by `auto-update-check.ts`, which swallows
  every failure, that would be **silent and permanent** — reproducing the exact failure class issue
  #1400 was filed about, in a new file.
- `harness_cfg_set` is worse in a different direction: it has no guard at all, so a missing PyYAML
  raises `ImportError` and aborts `bin/update` under its `set -euo pipefail` (`bin/update:2`).

A safer mechanism already exists in this repository. `conduct-ts config read` / `conduct-ts config
write` (`src/conductor/src/cli.ts:132-205`) read and write `~/.ai-conductor/config.yml` using
`js-yaml`, with an atomic temp-file-and-rename write (`user-config.ts:70-82`) that preserves every
other top-level key. `docs/reference/cli.md:520-521` records that these commands already replaced
`bin/install`'s "earlier direct PyYAML reads/writes" for the viewer and renderer sections. Delegating
is therefore an established precedent in this codebase, not a new pattern.

**Verified constraint:** `detectUserConfigReadCommand` (`cli.ts:133-136`) accepts an arbitrary dotted
path and is immediately reusable. `detectUserConfigWriteCommand` (`cli.ts:139-158`) is *not* — it is
section-positional (`config write <section> <preset> <command> <args> <mode>`) and hard-restricted to
`markdown_viewer | mermaid_renderer`. It cannot express a scalar write.

**Second verified constraint:** `readUserConfig()` (`user-config.ts:31-70`) performs **no schema
validation** — `docs/reference/configuration.md:46-47` confirms validation of the user file happens
only after the project merge. So a bad value written into `conductor:` would not fail at write time;
it would fail at every subsequent `loadMergedConfig()`, which per #1026 blocks every project on the
machine.

## Options Considered

### Option A: Extend `harness_cfg_get`/`harness_cfg_set` and require PyYAML

- **Pros:** No new CLI surface; smallest diff.
- **Cons:** Makes PyYAML a hard prerequisite for update checks with no installer enforcement, and the
  read path's failure mode is a silent wrong answer rather than an error. Rejected on the failure
  mode alone.

### Option B: Hand-roll a minimal YAML reader/writer in bash or pure `python3`

- **Pros:** No PyYAML, no new CLI surface.
- **Cons:** A second YAML implementation in the repository that must agree with `js-yaml` on quoting,
  booleans, and key preservation forever. Rewriting the file without a real parser risks destroying
  the operator's `markdown_viewer` block. Rejected.

### Option C: Delegate to `conduct-ts config`, adding a generic scalar-set verb

- **Pros:** One YAML implementation for the whole repository. No Python dependency of any kind. Reuses
  the atomic, key-preserving write already proven for the viewer sections. Follows the precedent
  `docs/reference/cli.md:520-521` already documents.
- **Cons:** `bin/update` becomes dependent on a built `conduct-ts`, which is not guaranteed in every
  state (a fresh clone before `bin/install` builds it). Requires an additive CLI verb.

## Decision

**Option C.**

1. **`conductor_cfg_get` delegates to `conduct-ts config read conductor.<key>`.** The existing
   generic dotted-path reader needs no change.

2. **A new additive verb `conduct-ts config set <dotted.path> <value>` is introduced** for scalar
   writes. `config write` is left exactly as it is — its positional viewer/renderer shape does not
   generalize, and overloading it would break its argument grammar. `conductor_cfg_set` delegates to
   `config set`.

3. **`config set` validates the `conductor` block before writing.** Because `readUserConfig()` does
   not validate and a malformed user config blocks every project on the machine (#1026), `config set`
   runs `validateConductorBlock` against the prospective post-write block and exits non-zero with the
   validator's own per-key message rather than persisting an invalid value. It also coerces
   `auto_check` to a real boolean — YAML `auto_check: "true"` is a string and would fail the
   validator's `typeof === 'boolean'` check (`config.ts:1159`). This turns the schema's existing
   per-key error messages into a real, enforced gate, which is the point of issue outcome #1.

4. **A missing or unbuilt `conduct-ts` is a loud failure, never a silent default.** If
   `conduct-ts` is unavailable, `conductor_cfg_get` returns non-zero and the caller warns explicitly
   rather than substituting a default. `bin/update`'s update check then declines to run with a stated
   reason. A skipped check that says so is recoverable; a silently disabled one is the defect being
   fixed.

5. **The `~/.claude/` legacy JSON is read by exactly one function**, the seed
   (`adr-2026-08-09-legacy-json-seed-migration-rule.md`), which parses flat JSON with `python3`'s
   stdlib `json` — no third-party dependency, and unchanged from today's mechanism.

## Consequences

- No PyYAML anywhere in the update-check path. `harness_cfg_get`/`harness_cfg_set` are left in place
  for the viewer helpers that still use them and are out of scope here.
- `bin/update` gains a runtime dependency on a built `conduct-ts`. This is already true in practice —
  `auto-update-check.ts` spawns `bin/update` *from* `conduct-ts` — but the forced, user-invoked
  `bin/update` path must degrade loudly, per decision 4.
- `conduct-ts config set` becomes a general-purpose user-config primitive. Its validation is scoped to
  the `conductor` block in this change; extending validation to other blocks is deliberately not
  attempted here.
- The new verb is additive to the `conduct-ts` CLI and requires a `docs/reference/cli.md` entry in the
  same PR.
