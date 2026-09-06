# Implementation Plan: Close the unguarded tmux fixture session that orphans keepalive loops

**Date:** 2026-09-06
**Stories:** .docs/stories/close-the-unguarded-tmux-fixture-session-that-orph.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing leak-guard contract — two-signal kills, tmpdir-rooted pane corroboration, fail-closed on an unresolvable signal, and a pre-run sweep that precedes the baseline — none of which this slice alters.

## Summary

Five bounded tasks deliver #1616 by putting the ordinary suite's one unguarded real tmux session under the leak guard and by removing the naming loophole that let it out. Production daemon restart behavior, the guard's kill contract, and the engineer session lifecycle are outside this small slice.

## Technical Approach

The leaked keepalive loops are test fixtures, not production panes. The suite creates real tmux sessions in exactly three files. Two of them name their sessions on the `cc-daemon-` prefix and are already swept and reaped. The third, the restart-wiring test, is an ordinary suite file that names its session `test-wiring-<hex>` and runs an infinite echo/sleep loop as its stand-in daemon command. That name is invisible twice over: the runner-level kill-switch refuses `new-session` and `respawn-pane` only for `cc-daemon-`-prefixed targets, so the fixture never had to lift the switch, and the leak guard filters every session listing by the same prefix, so neither the pre-run sweep nor the teardown reap ever inspects it. A run interrupted before teardown — a timeout, a killed worker, a Ctrl-C past the handler — therefore strands the session permanently, and every later run repeats the leak. That is the accumulation the issue observed.

The fix has two halves that must land together. First, drop the session-name condition from the kill-switch so that under `AI_CONDUCTOR_NO_REAL_EXEC=1` the real runner refuses to create or respawn any real session whatever its name; a test that genuinely needs real tmux then has to lift the switch explicitly, which is a visible, reviewable act rather than a naming accident. The refusal stays scoped to those two verbs, so every observation and cleanup verb the guard and the fixtures depend on — session existence probes, pane capture, session kill — keeps reaching tmux unchanged. Where the argv carries no resolvable session target the refusal still fires and says the target was unresolved, because failing open there would restore the loophole through malformed argv.

Second, move the restart-wiring fixture onto the guarded prefix and give it the same explicit save/delete/restore of the kill-switch that the stale-respawn end-to-end fixture already uses in this suite. That single rename is what actually closes the leak: the session becomes visible to the sweep, so a future interrupted run is self-healing at the next run's start, and it becomes visible to the reap, so a leak inside a completed run fails the run loudly instead of surviving it. Its temp-directory working directory already satisfies the guard's tmpdir corroboration, so no guard logic changes.

Use the suite's established real-tmux fixture pattern for the restart-wiring change: probe for tmux and return cleanly when it is absent, save the prior kill-switch value before deleting it, restore it and kill the session in one `finally`, and target sessions by their exact name. Comparable code lives in the stale-respawn end-to-end file's real-tmux block and in the tmux smoke file's banner; search for the files that delete `AI_CONDUCTOR_NO_REAL_EXEC` around a real session. Allowed variation is the marker and command text; what must not vary is that cleanup and switch restoration happen in `finally`. Guard-side regression coverage uses the injected `TmuxRunner` seam already used throughout the guard's own unit file, so no real tmux server participates. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, the corrected diagnosis, and both stories on 2026-09-06 (delegated).
- Verified: the runner's kill-switch block fires only for `new-session` and `respawn-pane` and only when the resolved target name starts with the daemon session prefix; the target is read from `-s` for creation and `-t` for respawn, with a leading `=` and trailing `:` stripped.
- Verified: the guard filters every session listing by the same daemon prefix, and both the pre-run sweep and the teardown reap consume only that filtered listing, so an unprefixed session is never inspected at all.
- Verified: the pre-run sweep runs before the baseline snapshot is taken and kills any listed session whose pane working directory resolves under the real temp directory; sessions whose pane working directory is a real checkout or is unresolvable are left running.
- Verified: the restart-wiring test creates a real session named with a `test-wiring-` prefix and a random suffix, in a temp directory it created, running an infinite echo/sleep loop, and kills it in a `finally`; it never touches the kill-switch.
- Verified: the vitest config excludes only the smoke directory and smoke-suffixed files, so the restart-wiring file runs in every ordinary suite invocation.
- Verified: the stale-respawn end-to-end file and the tmux smoke file name their sessions on the daemon prefix and both save, delete, and restore the kill-switch around their real-tmux blocks — the established pattern this plan reuses.
- Verified: the guard's own unit file already covers the sweep sparing a real-checkout pane cwd and an unresolvable pane cwd, so this plan adds no duplicate for those.
- Verified: `AI_CONDUCTOR_NO_REAL_EXEC` is set only by this repository's own test setup, so the widened refusal is unreachable in a consumer installation and changes no shipped behavior.
- Scope check: repository-only test-isolation machinery; no skill addition; provider-agnostic. Event spine: no new event, metric, span, or report channel — the guard's existing console reports are unchanged.
- Verify-claims verdict: CLEAR. The one load-bearing assumption in the issue — that a production keepalive mechanism exists — was checked and disproved; the corrected diagnosis is recorded in the track artifact and drives this plan.

## Tasks

### Task 1: Refuse real session creation under the kill-switch regardless of name
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-tmux.ts, src/conductor/test/engine/daemon-tmux.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit cases: with the kill-switch set, creating a session under an unprefixed name and respawning a pane in an unprefixed session each throw an Error whose message contains the environment variable name and the target session name; the existing prefixed-name cases keep passing unchanged.
2. Invert the existing case that asserts unprefixed names are not guarded, so it now asserts the refusal, and add a case proving that with the kill-switch unset a respawn against an absent session returns a non-zero exit code instead of throwing.
3. Verify the new cases fail (RED).
4. Implement: remove the prefix condition from the runner's kill-switch branch so the refusal covers every resolved session name, leaving the two guarded verbs and the message shape as they are.
5. Verify the cases pass (GREEN) and run the file through the project's scoped test invocation.
6. Commit with message: "fix(daemon-tmux): refuse real tmux sessions under the kill-switch regardless of name (#1616)".

**Done when:**
1. With the kill-switch set, creation and respawn are refused for both a prefixed and an unprefixed session name, and each thrown message contains the environment variable name and that session name.
2. No tmux process is started on a refused call, proven by asserting the session does not exist afterwards.
3. With the kill-switch unset, a respawn against an absent session returns a non-zero exit code and throws nothing.

### Task 2: Refuse an argv that carries no resolvable session target
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/daemon-tmux.ts, src/conductor/test/engine/daemon-tmux.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit cases: with the kill-switch set, a creation argv with no name flag and a respawn argv with no target flag each throw rather than reaching tmux.
2. Add a case for a target flag present but empty, so an empty string is treated as unresolved rather than as a name that passes the check.
3. Verify the cases fail (RED).
4. Implement: when the target cannot be resolved from the argv, refuse with a message that names the environment variable, names the refused verb, and states explicitly that the target was unresolved.
5. Verify the cases pass (GREEN) and run the file through the project's scoped test invocation.
6. Commit with message: "fix(daemon-tmux): fail closed when a guarded tmux verb has no resolvable target (#1616)".

**Done when:**
1. A creation argv with no name flag, a respawn argv with no target flag, and an empty target value are each refused under the kill-switch.
2. Each of those thrown messages names the environment variable, names the refused verb, and reports the target as unresolved.

### Task 3: Keep observation and cleanup verbs reaching tmux under the kill-switch
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/daemon-tmux.test.ts
**Dependencies:** 1

**Steps:**
1. Write unit cases asserting that with the kill-switch set, a session-existence probe, a pane capture, and a session kill against an absent daemon-prefixed session each return a result rather than throwing the kill-switch error.
2. Verify the cases pass against the widened refusal from Task 1, and that they fail if the refusal is broadened past the two guarded verbs.
3. Run the file through the project's scoped test invocation.
4. Commit with message: "test(daemon-tmux): pin observation and cleanup verbs as unrefused under the kill-switch (#1616)".

**Done when:**
1. Session-existence probe, pane capture, and session kill each return a result under the kill-switch and none of them throws the kill-switch error.
2. The cases fail if the refusal is widened beyond session creation and pane respawn.

### Task 4: Put the restart-wiring fixture session under the leak guard
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/engine/daemon-restart-wiring.test.ts
**Dependencies:** 1

**Steps:**
1. Rename the fixture session so its name carries the guarded daemon prefix followed by a restart-wiring marker and the existing random suffix, keeping the exact-name targeting the file already uses.
2. Save the prior kill-switch value, delete it before the first real tmux call, and restore it alongside the existing session kill in the block's `finally` — the same shape the stale-respawn end-to-end fixture uses; search for the files that delete the variable around a real session.
3. Write the failing assertion first: after the session is created, the leak guard's live session listing contains the fixture session name, and after cleanup it does not.
4. Verify RED against the current unprefixed name, then apply the rename and switch handling and verify GREEN.
5. Run the file through the project's scoped test invocation, confirming it still skips cleanly when tmux is absent.
6. Commit with message: "test(daemon-restart-wiring): name the real fixture session under the guarded prefix (#1616)".

**Done when:**
1. The fixture session name begins with the guarded daemon prefix and retains its random suffix.
2. An assertion inside the test observes the live fixture session in the leak guard's session listing while it is running.
3. A second assertion observes the same name absent from that listing after the block's cleanup has run.
4. The kill-switch value is restored in the same `finally` that kills the session, and the file still returns cleanly when tmux is unavailable.

### Task 5: Prove the pre-run sweep reaps a stranded restart-wiring session
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/tmux-leak-guard.test.ts
**Dependencies:** 4

**Steps:**
1. Write a failing regression case using the guard's injected runner seam: the listing returns a restart-wiring-shaped session whose pane working directory is a temp-directory fixture path, alongside an operator session whose pane working directory is a real checkout path.
2. Assert the sweep issues a kill for exactly the fixture session, names it in its killed result, and issues no kill for the operator session.
3. Verify the case fails when the fixture session is given the old unprefixed name, which the guard's listing filter drops.
4. Verify the case passes with the name Task 4 introduces, and run the file through the project's scoped test invocation.
5. Commit with message: "test(tmux-leak-guard): pin sweep coverage for a stranded restart-wiring session (#1616)".

**Done when:**
1. The sweep kills exactly the restart-wiring-shaped session and reports it in its killed result.
2. The operator session sharing the same listing receives no kill and is absent from the killed result.
3. The same case fails when the fixture session carries the old unprefixed name.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the restart-wiring test has created its real tmux session, when the leak guard lists live daemon sessions, then that session's name appears in the listing. | 4 | "An assertion inside the test observes the live fixture session in the leak guard's session listing while it is running." | diff-local |
| Story 1 happy: Given the restart-wiring test completes or fails, when its cleanup has run, then the leak guard's listing no longer contains that session name. | 4 | "A second assertion observes the same name absent from that listing after the block's cleanup has run." | diff-local |
| Story 1 negative: Given a previous run was interrupted and left a restart-wiring fixture session running with a temp-directory pane working directory, when the next run's pre-run sweep executes, then that session is killed and a session in the same listing whose pane working directory is a real repository checkout is left running. | 5 | "The operator session sharing the same listing receives no kill and is absent from the killed result." | diff-local |
| Story 2 happy: Given `AI_CONDUCTOR_NO_REAL_EXEC` is set to `1`, when the real tmux runner is asked to create a session or respawn a pane under any session name, then it throws an error naming both the environment variable and the resolved session name before any tmux process is started. | 1 | "With the kill-switch set, creation and respawn are refused for both a prefixed and an unprefixed session name, and each thrown message contains the environment variable name and that session name." | diff-local |
| Story 2 happy: Given `AI_CONDUCTOR_NO_REAL_EXEC` is unset, when the real tmux runner respawns a pane in an absent session, then the call reaches tmux and returns its non-zero exit code rather than throwing. | 1 | "With the kill-switch unset, a respawn against an absent session returns a non-zero exit code and throws nothing." | diff-local |
| Story 2 negative: Given `AI_CONDUCTOR_NO_REAL_EXEC` is set to `1` and the argv carries no resolvable session target, when the real tmux runner is asked to create a session or respawn a pane, then it still throws an error naming the environment variable and reporting the target as unresolved. | 2 | "Each of those thrown messages names the environment variable, names the refused verb, and reports the target as unresolved." | diff-local |
| Story 2 negative: Given `AI_CONDUCTOR_NO_REAL_EXEC` is set to `1`, when the real tmux runner is asked to run an observation or cleanup verb such as `has-session`, `capture-pane`, or `kill-session`, then the call reaches tmux unrefused. | 3 | "Session-existence probe, pane capture, and session kill each return a result under the kill-switch and none of them throws the kill-switch error." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local. Task 1 and Task 2 own unit coverage of the runner's kill-switch branch, exercised through the real runner with the environment variable set and restored per case; no real session is ever created because the refusal precedes the spawn. Task 3 owns the over-refusal boundary for the unguarded verbs at the same level. Task 4 owns the one real-tmux integration proof in this slice: it runs the actual fixture against a real tmux server and observes the session through the leak guard's own listing function, which is the exact function the suite's pre-run sweep and teardown reap consume, so the criterion proves reachability of the guard rather than of a helper. Task 5 owns the guard-side regression at the injected-runner seam, with no real tmux server, and deliberately adds no duplicate of the guard's existing spared-session and unresolvable-cwd cases. No real LLM, network, or other third-party service participates in any task, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4 -> Task 5
