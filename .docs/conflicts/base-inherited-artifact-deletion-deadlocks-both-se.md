# Conflict Check: base-inherited protected-artifact deletion (#1752, absorbs #1676)

**Date:** 2026-10-07
**Stories checked:** `.docs/stories/base-inherited-artifact-deletion-deadlocks-both-se.md` (Stories 1–6)
against every story file in `.docs/stories/`. Seal-related files were examined in depth:
`2026-07-26-rebased-features-stale-protected-artifact-seal-976.md`,
`manual-rebase-strands-protected-artifact-seal.md`, `an-operator-s-protected-artifact-reseal-is-invisib.md`,
`no-operator-command-to-reseal-a-protected-decide-a.md`.
**ADR corpus:** `repo_wide` (from `.ai-conductor/config.yml`). Examined: `adr-2026-07-26-protected-artifact-seal-rebaseline`,
`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`, `adr-2026-08-09-seal-rotation-authorship-predicate`,
`adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`, `adr-2026-08-09-operator-only-scoped-artifact-reseal`,
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`, `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`.
Narrowed out: every ADR whose subject is not the protected-artifact seal or reseal.
**Result:** PASSED after resolution. 4 blocking conflicts were resolved and 0 remain.

## Conflict 1: Reseal entry set must be unchanged
**Stories involved:** no-operator-command Story 2 vs this feature's Story 5
**Type:** contradiction · **Severity:** blocking
The old story said a reseal's entry set has "no path added, none removed", which contradicts the
reseal prune in ADR D8.
**Resolution (operator-selected):** the old assertion and its Done When item are qualified in place
to exempt audited base-inherited deletion prunes.

## Conflict 2: Reseal of a deleted named path is refused
**Stories involved:** no-operator-command Story 2 vs Story 5
**Type:** contradiction · **Severity:** blocking
**Resolution:** the refusal now applies only to deletions authored by this feature, whether in a
branch commit or uncommitted. A named target whose deletion was base-inherited is pruned with an
audit record.

## Conflict 3: Unnamed deleted artifact refuses the reseal
**Stories involved:** no-operator-command Story 3 vs Story 5
**Type:** contradiction · **Severity:** blocking
**Resolution:** the refusal now applies only to feature-authored deletions. A base-inherited
deletion does not refuse the reseal.

## Conflict 4: A non-escalating or refused rotation leaves the seal byte-identical
**Stories involved:** manual-rebase-strands Story (non-escalation; feature-authored refusal) vs
Stories 1, 2 and 4. ADR D4 as first drafted is also involved.
**Type:** state-conflict · **Severity:** blocking
The first draft pruned after inspection passed, before rotation was evaluated. In the #1752 shape
(an inherited deletion plus a feature-authored rotation refusal), that would write a prune and then
halt, which violates the pinned rule that a refused rotation leaves the seal byte-identical.
**Resolution:**
- ADR D4 (new, not yet on `main`) is revised in place: a prune is persisted only on an `ok` composed
  verdict, and is folded into the rotation write when rotation is permitted.
- The old non-escalation assertion is qualified in place: a rotation writes nothing, and an audited
  inherited-deletion prune made by a passing inspection is the only allowed write.
- Story 4 gains the #1752-shape negative path and the folded-write happy path.

## Examined, no conflict
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`: "Third-party tampering,
  additions, and deletions are all unchanged". This states that ADR's own effect, and
  feature-authored deletions still halt. About 80% confident.
- Story 1 of the #976 file ("rotation re-anchors to the current set" for base-deleted paths) is
  consistent with this feature.
- no-operator-command Story 8 ("a build deletes a protected artifact … fails naming that artifact")
  is consistent, because it covers a feature-authored deletion.
