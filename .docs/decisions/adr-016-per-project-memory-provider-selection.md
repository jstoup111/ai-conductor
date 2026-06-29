# ADR 016: Per-Project Memory Provider Selection

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

## Context

FR-1 requires an operator to select the active memory platform **per project**, with **exactly one**
active at a time (no per-category mixing) and a built-in default when nothing is chosen. FR-2 requires
that an unknown/unavailable selection never breaks a run — the harness reports it and falls back to the
default. Open Question 6 asks *how a project expresses its platform choice (the config surface)*.

Forces:
- The harness already has a per-project, committed config file `.ai-conductor/config.yml` whose
  `HarnessConfig` (`src/conductor/src/types/config.ts:208-243`) carries plugin-selection fields
  `llm_provider` and `ui_renderer`. A memory selection should follow that exact pattern, not a new file.
- Selection must be resolved **at run start** so every memory-using step sees the same active provider.
- Resolution must be total: any bad/empty/unknown value resolves to the default, never an error
  (FR-2, FR-13).

## Options Considered

### Option A: `memory_provider` field in `.ai-conductor/config.yml` (mirror `llm_provider`/`ui_renderer`)
- **How:** A single string field naming the active provider; absent/empty/null → built-in default
  (`local`). Resolved once at run start to an "active provider" value carried through the run.
- **Pros:** Consistent with existing plugin selection; committed and per-project; one obvious place to
  look; trivial to default and to validate.
- **Cons:** String field needs a clear resolution + fallback contract (handled below).

### Option B: A dedicated `.memory-provider` file or `.claude/settings.json` key
- **Pros:** Separate from harness config.
- **Cons:** Fragments configuration across files; diverges from the established `llm_provider`/
  `ui_renderer` precedent; nothing gained. Rejected.

### Option C: Per-category selection (different provider per memory category)
- **Cons:** **Explicitly forbidden by FR-1** ("no per-category mixing; switching changes the whole
  project"). Rejected.

## Decision

Add a single **`memory_provider`** field to `HarnessConfig`, set in the project's **harness config
YAML** (`.ai-conductor/config.yml`), mirroring `llm_provider`/`ui_renderer`.

**The harness config YAML is guaranteed present in every project** *(operator decision, 2026-06-29)*.
Rather than treating "no config file" as an implicit default, **bootstrap/project setup ensures the
harness YAML exists in any project** and seeds it with at least the default `memory_provider`. So the
memory choice always has an explicit, in-file home — discoverable and diffable — and the default is a
written value, not the absence of a file. A genuinely absent or unreadable file still resolves safely
to `local` (the resolution contract below is total regardless), but the normal state is that the YAML
is there.

Resolution contract (run start, total function):
1. Read `memory_provider`. **Absent / empty / malformed → `local`** (the built-in default), with a
   one-line note, never an error (FR-1, FR-2).
2. **Names a provider that is not installed/known → warn clearly and use `local`** (FR-2).
3. **Names an installed provider that is unavailable at run start → warn and use `local`** (FR-2, FR-13).
4. The resolved value is the single **active provider** for the whole run; there is no per-category
   override (FR-1).

The resolved active provider is surfaced to memory-using steps (the memory step, recall in design
steps, project setup) so they all act against one provider (FR-10), and its guidance is activated
(ADR-019).

Why: reuses the one config surface operators already use for plugin choice, keeps "exactly one active"
trivially true, and makes the safe-fallback behavior a property of resolution rather than scattered
error handling.

## Consequences

### Positive
- One familiar place to choose memory, symmetric with other plugins.
- Fallback-to-default is centralized in resolution → FR-2/FR-13 satisfied uniformly.
- Per-project isolation is automatic (config is per-repo); no cross-project leakage (story FR-1
  negative path).

### Negative
- The active-provider value must be threaded to skills (via a session-start hook or conductor context
  injection); that plumbing is new (see ADR-019 follow-ups).
- A committed config means a provider choice is shared with anyone cloning the repo; an operator using
  a personal external platform may prefer the user-level `~/.ai-conductor/config.yml` — both are
  supported by precedence, project overrides user.

### Follow-up Actions
- [ ] Add `memory_provider?: string` to `HarnessConfig` with default resolution to `local`.
- [ ] Bootstrap/project setup ensures the harness config YAML exists in any project and seeds an
      explicit default `memory_provider` (so the choice always has an in-file home).
- [ ] Implement the run-start resolver (the 4-step total function above), emitting at most one warning
      per run for a bad/unavailable selection (bounded per ADR-021).
- [ ] Decide the surfacing mechanism for the active provider to skills (session-start hook vs.
      conductor context) — track with ADR-019.
- [ ] Document the field in `README.md` and `src/conductor/README.md` (Docs-track-features).
