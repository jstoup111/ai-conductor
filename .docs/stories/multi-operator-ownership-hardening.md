# Stories: Multi-operator ownership hardening

Track: technical (acceptance criteria live here; no PRD).
Derived from adr-2026-07-01-machine-scoped-operator-identity (Approved).

Status: Accepted

---

## Story 1 — Identity resolved from machine (user) config, never project config (D1)

As an operator, my daemon's identity comes from my machine so it can't be set by the
shared repo.

- **Given** `~/.ai-conductor/config.yml` has `spec_owner: jstoup111` **and** the repo's
  committed `.ai-conductor/config.yml` has no `spec_owner`,
  **When** the daemon/authoring resolves its owner,
  **Then** the resolved owner is `jstoup111` (read from user config, bypassing the
  project-over-user merge).
- **Given** user config sets no `spec_owner` but `gh` is authenticated as `jstoup111`,
  **When** owner resolves,
  **Then** the owner is `jstoup111` via the `gh` fallback (chain: user → gh → unresolved).
- **(Negative / leak attempt)** **Given** the repo's committed project config contains
  `spec_owner: jstoup111` and a *different* machine has user `spec_owner: bill`,
  **When** Bill's daemon resolves its owner,
  **Then** the owner is `bill` (the committed project value is never consulted for
  identity) — the project value cannot override the machine identity.

## Story 2 — Committed project-level spec_owner is rejected (D2)

As an operator, I'm stopped loudly if an identity is committed into a shared repo.

- **(Negative, primary)** **Given** a committed project `.ai-conductor/config.yml`
  containing a `spec_owner` key,
  **When** config is loaded (daemon start or authoring),
  **Then** config load FAILS with a distinct error naming the file and the fix ("move
  spec_owner to ~/.ai-conductor/config.yml"); the daemon does not start and authoring does
  not proceed.
- **Given** a committed project config with NO `spec_owner`,
  **When** config loads,
  **Then** load succeeds (guard only triggers on the leak).
- **(Edge)** **Given** a project config with a blank/whitespace `spec_owner:` value,
  **When** config loads,
  **Then** it is still rejected (a present key is the leak signal, blank or not).

## Story 3 — Daemon fails closed on unresolved identity (D3)

As a co-operator, an unidentified daemon can never build my specs.

- **(Negative, primary)** **Given** no user-config `spec_owner` AND `gh` is not
  authenticated (no login),
  **When** the daemon starts a poll pass,
  **Then** it builds NOTHING and logs a loud, distinct line: identity unresolved, set
  `spec_owner` in `~/.ai-conductor/config.yml` or authenticate `gh`. It does NOT fall back
  to building un-owned specs (reverses prior fail-open).
- **Given** identity later resolves (operator sets `spec_owner` and restarts),
  **When** the next pass runs,
  **Then** owner-gated dispatch resumes normally.

## Story 4 — Authoring fails closed on unresolved identity (D3)

As an operator, I never accidentally create an un-owned spec.

- **(Negative, primary)** **Given** identity is unresolved (no user `spec_owner`, no `gh`),
  **When** a spec is landed (engineer land OR plain conduct DECIDE authoring),
  **Then** the land is REFUSED with a loud error; no `spec/<slug>` branch, no intake
  marker, and no un-owned artifact is created.
- **Given** identity resolves to `jstoup111`,
  **When** the spec lands,
  **Then** the intake marker is written with `Owner: jstoup111` (Story 5).

## Story 5 — Every DECIDE path stamps the owner (D4)

As an operator, a spec I author is owned regardless of which entry point I used.

- **Given** a spec authored via plain `/conduct` DECIDE (not `/engineer`) with resolved
  identity `jstoup111`,
  **When** the spec is committed,
  **Then** `.docs/intake/<slug>.md` carries `Owner: jstoup111` — identical to the
  `/engineer` path.
- **Given** a spec authored via `/engineer`,
  **When** it lands,
  **Then** it stamps as before (no regression).

## Story 6 — Un-owned merged specs are surfaced loudly, not silently skipped (D5)

As an operator, legacy un-owned work is visible, never a silent black hole.

- **(Negative, primary)** **Given** a merged spec on the default branch with NO `Owner:`
  marker (legacy/pre-hardening) and a resolved daemon owner,
  **When** the daemon's discovery pass evaluates it,
  **Then** it is skipped AND a distinct, deduped log line states it is un-owned and how to
  fix it (add an `Owner:` marker on the default branch) — surfaced once per slug, not
  silently dropped.

## Story 7 — Cutover guarded/documented for the self-host repo (D6)

As the harness maintainer, I can't accidentally trigger a rebuild of all shipped specs.

- **Given** the operator setup + self-host docs,
  **When** an operator reads how to configure `owner_gate_cutover`,
  **Then** the docs state it is a per-repo policy for repos with an UNBUILT backlog and
  MUST NOT be set on the harness self-host repo (grandfather would rebuild all merged
  specs).
- **(If guard chosen over doc-only)** **Given** `owner_gate_cutover` is set AND the repo is
  detected as the harness self-host,
  **When** config validates,
  **Then** a loud warning is emitted (non-fatal) explaining the rebuild hazard.

## Story 8 — Deterministic precedence: explicit machine identity wins over ambient gh (D1 edge)

- **Given** user `spec_owner: jstoup111` set AND `gh` authenticated as a *different* login
  `jstoup-alt`,
  **When** owner resolves,
  **Then** the owner is `jstoup111` (explicit user config wins over ambient `gh`) —
  deterministic, no dependence on gh auth state.
