# ADR 003: Registry write mechanism + bootstrap integration

**Date:** 2026-06-25
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.2 — project registry + creation

> **Numbering:** `adr-002` is reserved by Phase 9.1 (PR #82, not yet merged to `main`); this ADR
> is `adr-003` to avoid a post-merge collision.

## Context

9.2 has **three** registry-write entry points — `conduct register`, `conduct create`, and
`/bootstrap` (a Markdown skill executed by Claude). All must produce the same well-formed,
deduplicated, atomically-written records (PRD FR-1..FR-11), and registry writes must **report**
failures (registration is a deliberate user action), unlike the engineer store's best-effort emission.

Forces:
- `/bootstrap` is not TypeScript — it can't import a TS module; it can only run a command or write
  a file per prose instructions.
- Multiple writers + future daemons → atomicity + dedup must be guaranteed, not hoped for.
- `create` overlaps `/bootstrap` scaffolding (conflict-check FR-6 × ST-026) — `create` must be a
  minimal skeleton, not a second onboarding implementation.

## Options Considered (bootstrap integration)

### Option A: single writer lib behind the CLI; `/bootstrap` calls `conduct register`
All writes funnel through one TS registry module exposed as `conduct register`/`conduct create`;
the bootstrap skill invokes `conduct register` as a subprocess.
- **Pros:** atomicity, canonical-path dedup, schema, credential redaction, and validation live in
  **one** place; `/bootstrap` stays declarative; consistent error reporting.
- **Cons:** `/bootstrap` depends on the conduct-ts CLI being on `PATH` (already true where the
  harness runs).

### Option B: `/bootstrap` writes `registry.json` directly
Claude edits the JSON per SKILL.md prose.
- **Pros:** no CLI dependency in bootstrap.
- **Cons:** duplicates atomic-write/dedup/redaction logic in prose; **no atomicity guarantee**;
  drifts from the lib's schema — fragile and a corruption risk.

## Decision

**Adopt Option A** — a single registry module is the **only** writer, exposed as `conduct
register`/`conduct create`; `/bootstrap` invokes `conduct register`. One implementation owns
atomicity, dedup, schema, redaction, and error reporting; the three entry points are thin.

**Mechanism (locked):**
- Path: `resolveRegistryPath({home, env})` → `~/.ai-conductor/registry.json`, `$AI_CONDUCTOR_REGISTRY`
  override, injectable for tests (mirrors `user-config.ts`).
- **Atomic write:** serialize the whole registry, write to `registry.json.tmp`, `rename` over the
  target (POSIX-atomic). Readers never see a partial file.
- **Dedup:** by **canonicalized absolute path** (`realpath`), so symlinked/relative paths to the
  same repo are one record (FR-4).
- **Error reporting:** register/create surface write failures as non-zero exit + message; **not**
  swallowed (contrast the engineer store).
- **`create` = skeleton:** git init + template CLAUDE.md + `.gitignore` (`.pipeline/`,`.daemon/`,
  `.worktrees/`) + register; no stack detection (that stays in `/bootstrap`). `--remote` →
  `git remote add` only (no push).
- **Status provenance:** an upsert **does not downgrade** `created` → `registered`; a project
  scaffolded by `create` keeps `status: created` even after a later `/bootstrap` register.
- **Credential redaction:** a `remote` URL embedding `user:token@` is stripped to a credential-free
  form before write (FR-11). No token reaches disk.
- **Reader:** types-only `RegistryReader` + `ProjectRecord` exported for 9.3; no runtime consumer.

> **Decision index (backfilled 2026-10-03, #2140).** Additive citable ids over the approved text above;
> no change of substance. Each id names a decision exactly as already stated above.
>
> **D1** — A single registry module is the only writer, exposed as `conduct register`/`conduct create`, and `/bootstrap` invokes `conduct register` (above: "Adopt Option A — a single registry module")
> **D2** — The registry path resolves via `resolveRegistryPath({home, env})` to `~/.ai-conductor/registry.json`, with an `$AI_CONDUCTOR_REGISTRY` override, injectable for tests (above: "Path: `resolveRegistryPath`")
> **D3** — Writes are atomic: serialize the whole registry, write `registry.json.tmp`, `rename` over the target; readers never see a partial file (above: "Atomic write:")
> **D4** — Records are deduplicated by canonicalized absolute path (`realpath`) (above: "Dedup: by canonicalized absolute path")
> **D5** — register/create surface write failures as non-zero exit + message, not swallowed (above: "Error reporting:")
> **D6** — `create` is a skeleton: git init + template CLAUDE.md + `.gitignore` + register, no stack detection; `--remote` is `git remote add` only, no push (above: "`create` = skeleton:")
> **D7** — An upsert does not downgrade `created` → `registered` (above: "Status provenance:")
> **D8** — A `remote` URL embedding `user:token@` is stripped to a credential-free form before write; no token reaches disk (above: "Credential redaction:")
> **D9** — Types-only `RegistryReader` + `ProjectRecord` are exported for 9.3, with no runtime consumer (above: "Reader: types-only")

## Consequences

### Positive
- One audited writer → correctness (atomicity/dedup/redaction) guaranteed once, reused thrice.
- `/bootstrap` and `create` stay thin; the registry schema evolves in one module.

### Negative
- `/bootstrap` gains a dependency on the conduct-ts CLI (acceptable — it already runs in that env).
- `realpath` canonicalization must handle a not-yet-existing `create` target carefully (canonicalize
  the parent, then join).

### Follow-up Actions
- [ ] Registry module: `resolveRegistryPath`, `readRegistry`, `upsertProject` (canonical-path dedup),
      atomic temp+rename write, `redactRemote`, `RegistryReader`/`ProjectRecord` types.
- [ ] `conduct register` + `conduct create` CLI subcommands (conduct-ts).
- [ ] `skills/bootstrap/SKILL.md`: add an auto-register step invoking `conduct register`.
- [ ] Status-provenance preserve rule + tests; credential-redaction tests.
