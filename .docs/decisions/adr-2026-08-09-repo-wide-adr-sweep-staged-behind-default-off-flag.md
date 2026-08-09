# ADR: The repo-wide ADR sweep is staged behind a default-off config key

**Date:** 2026-08-09
**Status:** Approved
**Deciders:** James Stoup (operator), DECIDE for intake #1391
**Relates to:** `adr-2026-08-09-adr-contradiction-detection-in-two-halves` (amends the scope of its
HALF 1 corpus; does **not** supersede it)

## Context

`adr-2026-08-09-adr-contradiction-detection-in-two-halves` gives `conflict-check` the
`.docs/decisions/` corpus so an ADR contradicting a story is caught before the plan is approved. It
did not fix **how much** of that corpus is swept, and the two candidate scopes have very different
risk profiles.

Measured on this repository: **245 ADR files, 177 of them approved** (non-superseded).

Four risks were identified during conflict-check, and every one of them scales with corpus size
rather than existing at any scale:

| Risk | At change-set scope (1–3 ADRs) | At repo-wide scope (177) |
|---|---|---|
| A relevance-narrowing step is needed, and is itself unverifiable LLM judgment | not needed | required; a wrong exclusion yields a *false clean* that looks covered |
| Superseded-status parsing becomes load-bearing | moot — a spec's own ADRs are freshly approved and never superseded | load-bearing and genuinely ambiguous |
| Operator fatigue from false positives, versus intake #1391's outcome 4 (no added prompt for agreeing specs) | bounded, negligible | the dominant risk; a noisy gate gets waved through, which silently removes it |
| Scope asymmetry between the two halves confusing a future author | none — both halves are change-set scoped and match | present |

The superseded-parsing risk is concrete, not theoretical. Real status lines in this corpus include:

    **Status:** SUPERSEDED in part by `<a>` (BUILD-tail ordering only) and `<b>` (same-file
    composition exception only)
    **Status:** APPROVED; finish-boundary behavior amended by `<x>`
    **Status:** SUPERSEDED in part by `<a>`; previously superseded in part by `<b>`

"Superseded in part" is partly binding. Misreading it in one direction compares stories against dead
decisions; in the other, it skips a live one.

The decisive observation about what the default must cover: **intake #1391's actual observed
failure was same-spec.** The contradicting ADR in `adr-approval-gate-before-build` was
`adr-2026-08-08-single-adr-approval-parser-three-rungs`, authored inside that feature and dated the
same day. A change-set-scoped sweep catches the failure this issue was filed about.

## Options Considered

### Option A: Repo-wide by default
- **Pros:** Strongest coverage. Catches a new story contradicting an ADR approved months ago —
  the harder failure, and the one nothing else in DECIDE sees.
- **Cons:** Ships all four risks above to every consumer repository on day one, with no evidence
  about false-positive rates and no way to gather it safely. The fatigue risk is self-concealing:
  a gate that gets waved through looks like a gate that passes.

### Option B: Whole ADR corpus feature off by default
- **Pros:** Zero new risk for consumers.
- **Cons:** Gives up more than the risk requires. Consumers would get **no** pre-plan ADR detection
  at all — not even for the same-spec case that intake #1391 actually observed — so outcome 1 goes
  undelivered by default for a risk that only materializes at scale.

### Option C: Change-set corpus by default; repo-wide behind a flag (chosen)
- **Pros:** Delivers outcome 1 for the observed failure everywhere. Confines all four risks to a
  single repository where they can be measured. Removes the scope-asymmetry risk entirely at
  default settings, because both halves are then change-set scoped.
- **Cons:** Inherited-ADR contradictions go undetected in consumer repositories until the default
  flips. Adds a config key, and flags tend to calcify.

## Decision

**Adopt Option C.** `conflict-check`'s ADR corpus scope is configurable, defaults to the change
set, and is set to repo-wide in this repository only:

```yaml
conflict_check:
  adr_corpus: change_set   # default; this repository sets repo_wide
```

- **`change_set`** (default) — sweep only the ADRs in this spec's own change set. No narrowing step,
  no superseded parsing, bounded false-positive surface.
- **`repo_wide`** — sweep all approved ADRs. Requires the relevance-narrowing step and the
  superseded-exclusion rule, both of which apply *only* in this mode.

Two constraints ride with `repo_wide`:

1. **The narrowing must be recorded.** The sweep states which ADRs it examined and which it
   narrowed out, so a skipped sweep is distinguishable from a clean one. This does not *verify* the
   narrowing — see Consequences — but it makes the omission auditable.
2. **Superseded exclusion is conservative.** Only an unambiguous full supersession excludes an ADR.
   Anything reading as partial ("superseded in part", "amended by") stays **in** the corpus — fail
   toward comparing, since a false conflict costs an adjudication while a false clean costs a
   mid-BUILD halt.

**HALF 2 is not gated.** The `adr` coherence row class ships on by default: its row count is bounded
by the spec's own ADRs, it is fail-closed, it is backward compatible via
`adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`, and none of the four risks apply to it.

### Exit condition

This flag is explicitly temporary. It is resolved when **either** of the following holds, and the
resolution is recorded in a superseding ADR:

- **Flip the default to `repo_wide`** once this repository has run at least 10 specs under
  `repo_wide` with **zero** false-positive blocking conflicts (a conflict the operator adjudicated
  as "not actually contradictory"), **and** the narrowing step has not been observed to exclude an
  ADR that a later BUILD halt proved relevant.
- **Remove `repo_wide` and delete the key** if false positives make the sweep net-negative, or if
  the narrowing proves unreliable.

A flag with no exit condition becomes permanent by default; this section is what prevents that.

## Consequences

### Positive
- Outcome 1 is delivered to every consumer for the failure mode actually observed in #1391.
- The four scale risks are confined to one repository and become measurable rather than theoretical.
- At default settings both halves share one scope, so there is no asymmetry for a future author to
  "harmonize" wrongly.
- Uses an established mechanism — per-project `.ai-conductor/config.yml` with boolean/enum keys
  (`build_review.enabled`, `auto_restart_on_stale_engine`) — rather than a novel one.

### Negative
- **Consumers get no inherited-ADR contradiction detection until the default flips.** This is the
  deliberate trade, and it is the weaker half of the coverage story.
- **The `repo_wide` sweep remains unverified even where enabled.** Nothing proves it ran or that the
  narrowing was correct; recording the narrowed-out set makes it auditable, not enforced. This
  limit is accepted knowingly rather than papered over — a deterministic accounting check was
  considered and judged to grow scope beyond this change.
- Two code paths in one skill, and a flag that must eventually be removed.

### Follow-up Actions
- [ ] Add the `conflict_check.adr_corpus` key with default `change_set`, and document it in
      `docs/reference/configuration.md`.
- [ ] Set `adr_corpus: repo_wide` in this repository's `.ai-conductor/config.yml`.
- [ ] Record the narrowing and superseded rules in `skills/conflict-check/SKILL.md` as applying to
      `repo_wide` only.
- [ ] Revisit against the exit condition above once this repository has run 10 specs under
      `repo_wide`.
