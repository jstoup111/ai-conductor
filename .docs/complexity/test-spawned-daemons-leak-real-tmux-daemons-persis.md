# Complexity: test-spawned daemons leak — real tmux daemons persist after tests

Tier: S

## Rationale

- Two bounded code sites: (1) deep-seam test guard in the real tmux runner
  (`src/engine/daemon-tmux.ts` — refuse `new-session` under
  `AI_CONDUCTOR_NO_REAL_EXEC`), (2) daemon self-termination when its repo root
  no longer exists (per-tick check + clean exit in the daemon loop).
- No new models, external integrations, auth surfaces, or state machines.
- Expected story count: 2–3 (guard, self-terminate, negative paths).
- Technical track (no PRD); operator selected the minimal Approach A
  (deep guard + self-terminate, no global leak-detector gate).
