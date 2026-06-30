# ADR: Platform Adoption & Removal Surface

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

> **Command surface (operator decision, 2026-06-29):** the verb is **`add`**, not `adopt` —
> `conduct memory add <provider> | remove | status`. "Adoption" below is the *concept* (FR-6);
> the *command* is `add`.

## Context

FR-6 requires an operator to **adopt** a memory platform in a single deliberate action that performs
the needed setup (including credentials for external platforms), idempotently and without clobbering
existing configuration. FR-7 requires a clean, idempotent **removal** that returns the project to the
default. FR-8 requires the default to need **no adoption** at all. Open Question 2 asks *how a platform
is adopted/installed — the operator UX, provisioning, and credential handling*.

Forces:
- The harness already adopts agent-queried tools via `claude mcp add --scope user <name> -- <entry>`
  (Serena precedent, `bootstrap/SKILL.md:342-347`) and detects prior registration with
  `claude mcp get` — a natural idempotency check.
- Provider selection lives in `.ai-conductor/config.yml` (adr-2026-06-29-per-project-memory-provider-selection); adoption must **write that
  selection** and **register the MCP server**, as two parts of one action.
- The CLI surface for harness operations is `bin/conduct` (and the conductor); a memory subcommand
  fits there rather than a new entrypoint.
- Credentials for external platforms must be handled without leaving a "half-configured" state
  (FR-6 negative path) and without committing secrets.

## Options Considered

### Option A: A `conduct memory` subcommand group: `add <provider>`, `remove`, `status`
- **How:** `add <provider>` performs, idempotently: (1) verify/install the provider plugin; (2)
  register its MCP server (`claude mcp add`, guarded by `claude mcp get`); (3) prompt for/record any
  credentials via the environment/secret mechanism (never committed); (4) write
  `memory_provider: <provider>` to the harness config YAML without disturbing other keys. `remove`
  reverses (2)+(4), returning to `local`. `status` shows the resolved active provider.
- **Pros:** One deliberate action per FR-6; reuses the `claude mcp add`/`get` idempotency precedent;
  config write is a targeted key-set (no clobber); symmetric add/remove; default needs none (FR-8).
- **Cons:** New CLI surface to build and document; credential UX must be designed per provider.
- **Migration note:** changing `bin/conduct` CLI is a breaking-change gate (CLAUDE.md Release Gates) →
  requires a CHANGELOG `## Migration` block.

### Option B: Manual steps (operator edits config + runs `claude mcp add` themselves)
- **Cons:** Not "a single deliberate action" (FR-6); error-prone; easy to leave half-configured;
  no idempotency guarantees. Rejected.

### Option C: Adoption via the generic plugin-install flow only
- **Cons:** The generic plugin flow installs a plugin but does not also register the MCP server,
  prompt for credentials, and set `memory_provider` as one safe idempotent step. Memory adoption needs
  the composite action. (We *reuse* plugin install inside Option A, but don't rely on it alone.)
  Rejected as the whole answer.

## Decision

Adopt **Option A**: a **`conduct memory` subcommand group** — `add <provider>`, `remove`, `status`.

- **`add` is idempotent and non-clobbering (FR-6):** each sub-step checks-then-acts —
  `claude mcp get` before `claude mcp add`; targeted key-set for `memory_provider` leaving all other
  config intact; re-running `add` on an already-added provider is a clean no-op. An interrupted
  `add` re-runs to completion with no corrupt/partial state (each step is independently re-entrant).
- **Credentials (FR-6 negative path):** external-platform secrets are prompted for and stored via the
  environment/secret mechanism (e.g. `.env.local`/credential store), **never committed**; adopting
  without required credentials yields a **clear notice**, not a broken half-config.
- **Remove is clean and idempotent (FR-7):** unregisters the MCP server and resets `memory_provider`
  to default; removing an already-removed provider is a no-op; other providers/config are untouched;
  the next run cleanly uses `local` with no dangling reference.
- **Default needs nothing (FR-8):** `local` is the implicit provider; no `add` step, no service, no
  credentials.

Why: it makes adoption "one deliberate, safe, repeatable action" by composing the harness's existing
idempotent MCP-registration and per-key config-write primitives, and it gives removal an exact inverse.

## Consequences

### Positive
- Turnkey, idempotent add/remove per FR-6/FR-7; default untouched per FR-8.
- Reuses `claude mcp add`/`get` idempotency and targeted config writes — little new risk.
- `status` gives operators a clear view of the resolved active provider (aids debugging FR-2 fallbacks).

### Negative
- New `bin/conduct` CLI surface → **breaking-change gate**: needs a CHANGELOG `## Migration` block and
  README/`src/conductor/README.md` updates.
- Per-provider credential UX must be specified as providers are added (Phase 2); Phase 1 default needs
  none.

### Follow-up Actions
- [ ] Implement `conduct memory add <provider>|remove|status`, each step check-then-act (idempotent, re-entrant).
- [ ] Define credential handling (prompt + non-committed storage) and the missing-credential notice.
- [ ] Add the CHANGELOG `## Migration` block for the new CLI (Release Gate #2).
- [ ] Document the commands in `README.md` and `src/conductor/README.md`.
- [ ] Negative-path coverage: re-add no-op, interrupted-add re-run, add leaves other config
      intact, missing-credentials notice, remove-then-run-uses-default.
