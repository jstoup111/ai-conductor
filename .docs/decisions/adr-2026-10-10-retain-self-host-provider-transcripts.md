# ADR: Self-host provider transcripts are harvested at home retirement and retained by step verdict

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #611

## Context

Self-host dispatches run each provider against a throwaway home under
`«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»/`
([adr-2026-08-09-worktree-local-provider-scratch](adr-2026-08-09-worktree-local-provider-scratch.md)).
The provider writes its session transcript inside that home — Claude under
`projects/**/*.jsonl` (including subagent sidechains), Codex and Pi under `sessions/**/*.jsonl`
(verified against local `~/.claude`, `~/.codex`, `~/.pi/agent` layouts; the self-host home is the
same layout selected by `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `PI_CODING_AGENT_DIR`). Every
retirement path deletes the whole home: `SandboxBuildEnv.teardown()` and `ProviderHome.teardown()`
`rm` the home before `releaseScratchHome` runs, and the dead-owner sweep reclaims killed attempts.

So the one artifact that explains a failed, stalled, or zero-work dispatch is destroyed before
anyone can read it (#611: a try-3 build exited 0 having done nothing, tripped `no_task_progress`,
and its cause is unprovable). The scratch ADR's premise that "a home has no post-attempt value" is
false for the transcript it contains.

Two forces constrain the fix:

- **Timing.** Homes are retired inside the invocation's `finally`. The conductor decides
  `no_task_progress` afterwards (`build_stall` is emitted after the dispatch returns). A decision
  made at retirement cannot see zero-progress.
- **Secrets.** Homes hold seeded auth (`auth.json` for Codex and Pi, propagated state for Claude).
  Nothing beyond transcripts may leave the home.

## Options Considered

### Option A: Outcome-gated copy at retirement
- **Pros:** Small; no post-verdict state.
- **Cons:** Cannot observe zero-progress or stalls, which are exit-0 — the motivating case.

### Option B: Extend home lifetime until the verdict
- **Pros:** Full fidelity; no copy.
- **Cons:** Keeps credential-bearing homes alive past the attempt, breaks the scratch ADR's
  attempt-scoped lifetime, and complicates the dead-owner sweep.

### Option C: Tee the provider's stdout stream (`stream-json` / `--json`) to disk
- **Pros:** Layout-independent; survives a kill.
- **Cons:** The stream is not the full transcript (subagent sidechains and on-disk-only records
  can be absent), so it may not explain a zero-work dispatch.

### Option D: Allowlisted harvest at every retirement, retention decided after the verdict — chosen
- **Pros:** Full transcript including sidechains; home lifetime unchanged; zero-progress covered
  because keep/prune happens after the verdict; credentials cannot leak through an allowlist.
- **Cons:** Every attempt is copied briefly, including ones later pruned; a new per-worktree
  directory needs a cap.

## Decision

1. **Providers declare their transcripts.** The self-host shape of every built-in provider
   descriptor gains a required `transcripts` member holding a `globs` allowlist (Claude
   `projects/**/*.jsonl`; Codex and Pi `sessions/**/*.jsonl`) and a final-assistant-message
   extractor. Required by type, so a new
   self-host provider cannot ship without stating what to preserve. Only files matching the
   allowlist are ever copied; credentials and everything else stay in the home.
2. **One retirement seam harvests before any delete.** Every path that removes a provider home —
   `SandboxBuildEnv.teardown()`, `ProviderHome.teardown()`, and the dead-owner sweep's reclaim — goes through a single
   harvest-then-remove routine. No path deletes a provider home without first harvesting it.
   The native-schema scratch acquired in provider execution for non-self-host runs is not a
   provider home (it holds only an output schema; the provider writes to the operator's own home)
   and is out of scope. The owning step name is recorded in the scratch lease at acquisition so
   the sweep can file an interrupted capture under its step.
   Harvest is best-effort: a harvest failure is reported on the spine and never fails teardown,
   changes the step result, or blocks the sweep.
3. **Captures land in the worktree's run state.** Destination is
   `«worktree»/.pipeline/transcripts/«step»/«runId»-a«attempt»[-«member»]-«provider»/`, preserving
   paths relative to the home. Every captured JSONL line is sanitized before it is written:
   the line is parsed, every string value is passed through the existing `redactSafetyText`
   sanitizer, and the value of any key naming a credential (`api_key`, `token`, `secret`,
   `password`, `credential`, `authorization`, case-insensitive) is replaced with `[REDACTED]`;
   the line is re-serialized so it stays valid JSON. A line that does not parse is sanitized as
   raw text with `redactSafetyText`. Before the home is removed, every string value of eight or
   more characters in the provider's `selectedAuthPath` file inside that home, plus the daemon
   build token when one was injected into the child, is collected as a known secret and masked
   with `[REDACTED]` wherever it appears in a captured line — this catches credentials echoed
   inside free text, which key-based rules cannot see. Sanitizing raw JSONL text alone is insufficient, because that
   sanitizer's `key: value` patterns do not match quoted JSON keys, so a captured transcript satisfies the
   self-host confidentiality rule (FR-14 of `codex-safety-and-self-host-parity-907`): no token,
   secret, authorization header, or credential payload reaches persisted or operator-visible
   output. `.pipeline` is already gitignored and excluded from the live
   boundary, so no new exclusion is added. If #564 (open) later moves run
   state out of the worktree, captures move with `.pipeline`.
4. **Retention is decided at the verdict, failing toward retention.** A new capture is pending.
   When the conductor settles the owning step's outcome, it resolves that step's pending
   captures: a success that made progress prunes them; failure, any `build_stall` reason
   (including `no_task_progress`), HALT, or needs-human retains them. Sweep-recovered
   (interrupted) captures are always retained. A capture whose verdict never arrives (daemon died)
   stays on disk. A fixed count-and-size cap per worktree evicts the oldest retained captures.
5. **Every lifecycle transition rides the event spine.** New `ConductorEvent` variants announce
   captured (with path, provider, file count, bytes, interrupted flag), harvest-failed, retained,
   pruned, and evicted. No sidecar index file: the reader locates captures from
   `.pipeline/events.jsonl` plus the directory.
6. **A read-only CLI reads captures.** `ai-conductor transcripts «slug»` lists a feature's retained
   captures and prints the final assistant message of a chosen capture using the provider's
   extractor. It writes nothing.

## Consequences

### Positive
- A failed, stalled, zero-progress, or killed self-host dispatch of any step or rubric member can
  be explained from its own transcript.
- Successful attempts leave nothing behind beyond the cap window.
- Adding a self-host provider forces an explicit preservation decision.

### Negative
- Each attempt pays one copy of its transcript files, even when later pruned.
- Captures are redacted, not byte-identical to the provider's original files; a value the
  sanitizer misclassifies is masked in the capture. Captures stay local and gitignored.
- Captures in an in-worktree `.pipeline` are lost if the worktree is removed before #564 lands.

### Follow-up Actions
- [ ] Amend `adr-2026-08-09-worktree-local-provider-scratch` beside its "no post-attempt value"
      assertion (done in this spec).
- [ ] Implement per the plan for `preserve-self-build-provider-transcripts-on-failed`.
