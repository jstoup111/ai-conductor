# Complexity: finish/pr staleness-proof grep never matches git's actual "rebase (finish)" reflog wording

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| Story count | 2 (happy: a real in-progress-rebase reflog entry is recognized as staleness proof; negative: a genuinely foreign remote commit is still caught and blocks the push) |
| Files touched | 2 prompt files (`skills/finish/SKILL.md`, `skills/pr/SKILL.md`) + `CHANGELOG.md`; no test files exist for SKILL.md prose (verified by re-running the reproduction and the harness integrity suite) |
| New runtime code | None — a literal-string correction inside an existing, already-deterministic grep invocation |
| Decisions / conflicts | One real scope decision: correct the grep in place (prompt-level) vs. move the staleness derivation into engine machinery now that finish-choice recording is engine-owned (#499/PR #575) — see plan's "Scope Decision" section for the analysis and recommendation |

## Rationale

The root cause is empirically reproduced and isolated to a **literal string**: `skills/finish/
SKILL.md:87` and `skills/pr/SKILL.md:167` both run `git reflog | grep "rebase: finish"`, but a
real `git rebase` (reproduced in a scratch repo during this investigation) writes the reflog entry
`rebase (finish): returning to refs/heads/<branch>` — parenthesized, no colon after "rebase". The
grep's literal never appears in real git output, so the fallback staleness proof is dead code: it
always misses, in both skills, on every rebase git has ever performed.

This is not agent judgement or prompt discipline drift (the kind of thing the harness's
"deterministic where possible" principle warns needs machinery instead of a stronger prompt) — the
check was already meant to be a mechanical, deterministic grep; the defect is a copy/verification
error in the literal pattern, not an unreliable LLM step. Correcting the pattern to match git's
actual wording (`grep -E "rebase \(finish\)"`) restores the check to full determinism at the
existing call site, in both files PR #265 touched. Tier S: two single-line grep corrections plus
matching prose/checklist updates, no code, no schema, no CLI change. → **Tier S.**
