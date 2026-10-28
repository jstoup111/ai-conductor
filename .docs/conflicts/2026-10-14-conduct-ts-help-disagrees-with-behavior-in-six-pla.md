# Conflict Check: CLI help matches CLI behavior (#1012)

**Date:** 2026-10-14
**Stories checked:** `.docs/stories/conduct-ts-help-disagrees-with-behavior-in-six-pla.md` (Stories 1-8) against all `.docs/stories/` and approved ADRs.
**Result:** PASS after resolution — 1 blocking conflict and 4 overlaps resolved in place; 0 remaining.

## ADRs examined

Compared: adr-2026-10-14-commander-program-is-the-cli-catalog, adr-2026-07-04-event-driven-halt-clear-wake, adr-2026-07-03-engineer-checkpoint-commits-idempotent-land, adr-2026-07-04-park-unpark-cli-verbs.

Narrowed out (no overlapping subject): adr-2026-07-27-project-config-scaffolder, adr-003-registry-write-and-integration, adr-008-agent-hosted-loop-and-in-chat-authoring, adr-2026-07-07-daemon-owned-build-credential, adr-2026-07-27-codex-never-resumes-a-harness-minted-session, adr-2026-09-24-built-in-provider-catalog-and-boot-discovery, adr-2026-10-06-catalog-owned-interactive-model-and-effort, adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting, adr-2026-06-30-background-intake-brain-loop, adr-2026-07-07-single-generation-stale-respawn, adr-2026-07-10-daemon-stall-remediation, adr-2026-08-09-worktree-local-provider-scratch, adr-2026-07-25-content-addressed-full-suite-proof.

## Conflict: Help router would swallow `update --help`

**Stories involved:** Story 7 vs updating-the-harness Story (`update` passes arguments verbatim)
**Files:** [.docs/stories/conduct-ts-help-disagrees-with-behavior-in-six-pla.md] vs [.docs/stories/updating-the-harness-requires-cd-ing-to-its-checko.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-14-commander-program-is-the-cli-catalog
**Story ID:** Story 7
**ADR opposing sentence (verbatim):** "When argv names a declared command path and carries `--help` or `-h`, it prints that command's commander help and exits 0 without dispatching."
**Story opposing sentence (verbatim):** "`ai-conductor update [args...]` executes the resolved checkout's `bin/update` with the arguments verbatim and inherited stdio, and exits with its status"

**Description:** `bin/update` owns `-h|--help` (`bin/update:559`). A generic router would replace its full usage with commander's one-line description. ADR assumption A2 was false for `update`.

**Resolution Options:**
1. Exempt `update` from the router as a verbatim pass-through command.
2. Copy `bin/update` usage into the commander declaration.
3. Drop the generic router.

**Resolution (operator-selected):** Option 1. ADR Decision 2 and A2 revised in place (draft not on main); Story 7 gains an `update --help` pass-through negative path; architecture review notes the exemption.

## Conflict: Hidden daemon sub-verbs vs daemon help drift test

**Stories involved:** Story 4 vs conduct-daemon-help-omits-the-supported-pause-and- drift story
**Type:** overlap
**Severity:** degrading
**Description:** Existing story requires every dispatcher-accepted daemon verb to appear in `renderDaemonHelp()` output; Story 4 permitted a hidden daemon sub-verb to disappear.
**Resolution (operator-selected):** Story 4 now requires every dispatcher-accepted daemon verb to stay visible in daemon help.

## Conflict: Handoff help omits early-draft ready-marking

**Stories involved:** Story 1 vs adr-2026-07-03-engineer-checkpoint-commits-idempotent-land Decision 3
**Type:** overlap
**Severity:** degrading
**Description:** In early-draft mode handoff marks an existing draft PR ready instead of opening one.
**Resolution (operator-selected):** Story 1 handoff help names both opening the spec PR and marking an existing draft spec PR ready.

## Conflict: `--auto` help wording vs its existing rejection

**Stories involved:** Story 6 vs runmode-interactive-flag and remove-the-unattended-one-shot-inline-run-auto-the
**Type:** overlap
**Severity:** degrading
**Description:** `--auto` alone is already rejected toward the daemon; Story 6 implied a single flag never errors, and could have rewritten the `--interactive` description.
**Resolution (operator-selected):** Story 6 states `--auto` is rejected in favor of the daemon, keeps the `--interactive` REPL wording, and keeps the `--auto`-alone rejection.

## Conflict: `--all` carries two meanings

**Stories involved:** Story 5 vs status-hides-completed-features-by-default and expose-daemon-pause-resume-verbs
**Type:** overlap
**Severity:** degrading
**Description:** `--all` means "include completed features" on the daemon run command and "every registered repo" on fleet verbs.
**Resolution (operator-selected):** Story 5 describes each meaning on its own command.

## Re-check

All five resolved pairs re-checked in both directions after edits: no remaining contradiction or oscillation. Idle-poll default 60 agrees with adr-2026-07-04-event-driven-halt-clear-wake Decision 5.
