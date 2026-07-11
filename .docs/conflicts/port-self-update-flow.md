# Conflict check — port-self-update-flow

No blocking conflicts. This spec is a **blocker for #226** (bin/conduct removal) and
must land and build **before** #226 executes.

## Story-vs-story

Stories 1–8 partition disjoint entry points / branches of one flow (force check,
set-channel, tagged, main, no-TTY, seeding, auto-check, changelog render). No two
stories mutate the same state in contradictory ways. Story 9 is docs-only. Clean.

## Story-vs-existing-system

| Area | Interaction | Resolution |
|------|-------------|-----------|
| `bin/conduct` 327–470 | Source of the moved code; still present until #226. | Extract here; #226 deletes the block. Sequence: **this PR merges + builds → #226 removes the now-duplicated block.** Note for #226 so it removes the `bin/conduct` copy, not `bin/update`. |
| Shared bash helpers (`conductor_cfg_get/set`, `render_md`, `log/warn/ok/fail`) | Currently defined in `bin/conduct`; `bin/update` needs them. | Copy into `bin/update` or a sourced `bin/lib/*.sh`. If copied, #226 must not orphan the only remaining copy. |
| `~/.claude/ai-conductor.config.json` | Read/written by both `bin/conduct` and `bin/update` during the transition. | Same keys, same semantics — no schema change; concurrent use is safe (both idempotent config writes). |
| Auto-check on every run (line 2894) | Behavior owned by `bin/conduct` today. | Re-homed to `conduct-ts` startup spawning `bin/update --auto` (Story 7). Until #226, both may run; the check is idempotent so double-invocation is harmless (worst case: two "up to date" writes of `lastCheckedAt`). |
| HARNESS.md 286–307 | Documents the old mechanism. | Rewritten in this PR (Story 9). |
| Integrity suite (`test/test_harness_integrity.sh`) | `bin/*` scripts must pass `bash -n`. | `bin/update` added to the scanned set; must pass. |

## Resource / ordering

- **Ordering constraint:** merge + build this spec **before** #226 removes
  `bin/conduct`; otherwise the update mechanism vanishes between the two PRs.
  Recorded here and in the ADR.
- No lock/port/DB contention introduced.

**Verdict: clear** (with the documented #226 sequencing note).
