# Conflict Report: Harness skills and context files reach Pi sessions (#1888)

**Date:** 2026-09-29
**Stories checked:** `.docs/stories/harness-skills-and-context-files-reach-pi-sessions.md` (Stories 1-7). They were compared with every story in `.docs/stories/`, found by grep over the Pi, provider, installer, skill-invocation, and HARNESS.md vocabulary, with each hit read in full. The comparison also covered the story files on `origin/main` that are not yet on this branch, including the #1885 `pi-per-step-model-selection-via-wrapped-providers` stories.
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`). That is all 325 `adr-*.md`, plus the 9 ADRs changed only on `origin/main`, including the #1885 D12-D14 amendment to `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`.
**Result:** 1 blocking conflict, resolved (Stories resolution below; the story edit ships as a companion PR). 2 degrading clarifications and 2 ADR tensions were resolved in the new stories. 0 remaining.

## Conflict: `--providers` supported set excludes Pi

**Stories involved:** ST-901-1 (Select the required built-in provider set) vs Story 6 (bin/install accepts Pi as a selected provider)
**Files:** [.docs/stories/builtin-provider-installation-readiness-901.md] vs [.docs/stories/harness-skills-and-context-files-reach-pi-sessions.md]
**Type:** contradiction
**Severity:** blocking

**Description:** ST-901-1 fixes the supported set: "the error identifies Claude and Codex as the supported choices", and its Done-when says "the error lists both supported choices". Story 6 accepts `--providers pi`, and its error lists Claude, Codex, and Pi. The two cannot both hold.

**Resolution Options:**
1. Replace ST-901-1's supported-set assertions in place with the built-in set Claude, Codex, and Pi.
2. Scope ST-901-1 to "at least Claude and Codex" and leave the full set to Story 6.
3. Supersede ST-901 with a new story file.

**Recommendation and resolution:** Option 1. The story now tracks the catalog's built-in set, so there is one statement of truth. The land stem gate refuses foreign-stem story edits, so the in-place replacement of ST-901-1 ships as a companion `origin/main`-based PR that merges together with the spec PR.

## Clarification: Pi readiness source (degrading, resolved)

**Stories involved:** `pi-as-a-build-provider.md` Story 2 ("Given a descriptor omits a capability flag, when any consumer queries it, then the capability is treated as unsupported.") vs Story 6.

The Pi descriptor declares no `readiness` capability (ADR `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` D6), and Story 6 reported "Pi as ready". **Resolved:** Story 6 now says that readiness is `bin/install`'s own PATH and `pi --version` check, independent of the engine catalog's runtime `readiness` capability. The capability stays undeclared for Pi.

## Clarification and ADR tension: classification of a missing Pi skill (resolved)

**Parties:** `stop-retrying-an-unresolved-skill-dispatch-and-nam.md` (#1631) and ADR `adr-2026-08-04-unresolved-step-command-fails-by-name` D3 vs the original Story 2 negative path.

**ADR filename stem:** adr-2026-08-04-unresolved-step-command-fails-by-name
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "no retry attempt consumed, no effort or model escalation, no candidate-ladder walk"
**Story opposing sentence (verbatim, as first written):** "Given a Pi dispatch is refused for a missing skill and a further candidate is configured for the step, when the candidate ladder continues, then the next candidate runs and the Pi refusal reason stays in the recorded candidate outcome."

A Pi skill that cannot be resolved is the same fact as Claude's unresolved command. The first draft classified it as run-scope provider unavailability, which is wrong in two ways:
- It walks the ladder, which the ADR forbids for this fact.
- It would cache Pi as unavailable for the whole run over one skill.

**Resolved:** Story 2 now reports the miss with the existing unresolved-skill-command classification. A lifecycle step halts mechanically, naming the skill. An auxiliary member makes no further attempt. A later Pi step with a resolvable skill still spawns. A missing HARNESS.md, which is an installation-wide defect like a missing executable, stays run-scope provider-unavailable (Story 3).

## ADR tension: the adapter reads the dispatched command (no change required)

**ADR filename stem:** adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation
**Story ID:** Story 2
**ADR sentence (verbatim):** "The candidate executor stays generic and the provider implementations remain transports. They do not parse or rewrite arbitrary prompts."
**Story sentence (verbatim):** "Given a Pi prompt whose first line does not start with `/skill:`, when it dispatches, then no skill-resolution check runs and Pi is spawned as before."

**Not a conflict.** The Pi check reads the dispatched command token without rewriting the prompt. The later APPROVED `adr-2026-08-04-unresolved-step-command-fails-by-name` D2 already has a provider identify "the *exact command string this dispatch sent*" inside the adapter. That is `claude-provider.ts` `unresolvedCommandName`, which reads the prompt's first whitespace-delimited token. The Pi adapter mirrors that first-token read, so no ADR amendment is needed.

## Checked clean

- The Pi argv in `pi-as-a-build-provider.md` Story 5 and D5 is a baseline, not an exact list. The #1885 `--provider/--model/--thinking` flags are additive and disjoint from `--append-system-prompt`/`--skill` (overlap only at the code level; ordering is recorded in the plan).
- No story or ADR asserts that Pi prompts start with a bare skill name, that Pi "does not load skills", that the Pi home is `PI_HOME`, or that the review-policy refusal names #1888.
- `codex-safety-and-self-host-parity-907.md` NP-5 and `first-class-codex-harness-parity-904.md` concern Codex homes and syntax, and are compatible with Story 6's idempotence claim.
- `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`:
  - D1: Pi literals stay in the descriptor and `pi-provider.ts`.
  - D6: no capability flag changes. Story 7 changes only the owner text.
  - D8: the new checks run at dispatch, never at boot.
  - D12: adapter-level flags without a capability flag have precedent.
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` D7: both flags and the refusal live on the single `invoke` path.
- `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability`: no new event and no new skip reason are introduced.
- The remaining ADRs were narrowed out by subject: daemon, intake, release, seal, halt, memory. The superseded ADRs excluded from the corpus are all on unrelated subjects.

## Constraints carried to the plan

- The home-variable correction does not re-scope any self-host read. Pi stays refused for self-host until #1887.
- Any future Pi live smoke leg (#1890) must provision a skills root and a HARNESS.md link, or the new refusals fire on CI runners.
