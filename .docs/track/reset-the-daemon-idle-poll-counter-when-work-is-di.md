# Track: Reset the daemon idle-poll counter when work is dispatched

Track: technical

Scope boundary: Small fix for #2156, approved by the operator on 2026-09-06 (delegated). Make the `--max-idle-polls` ceiling count consecutive empty polls by restarting the count whenever a feature is actually dispatched, and correct the flag's reference wording in the same change. The ceiling's arithmetic (it fires on the poll after the Nth idle sleep), the waker's early-wake cadence, the idle-poll interval default, and every other daemon stop reason are outside this slice.

This is an internal daemon-loop correction to an already documented flag; acceptance criteria live in technical stories rather than a PRD.

The operator-delegate approved restarting the count at the one point where work actually starts — the successful dispatch — over the alternative of decrementing or time-windowing the counter. Dispatch is the only place the loop can distinguish "found work" from "found a candidate it could not start", and a candidate that never starts is genuinely an empty poll.

Scope check: A — the literal Step 1 signal "daemon machinery" reads harness-repo-only, but the deciding test is whether the mechanism exists outside this repository, and it does: `ai-conductor daemon --continuous --max-idle-polls` is a shipped consumer-facing CLI ceiling, and the pages that document it are consumer reference pages. Treated as consumer-facing; no behavioral rule file is touched either way, so no rule-placement split arises. B — n/a, no new skill. C — provider-agnostic; the loop and its documentation name no host, path, or provider variable. No catalog registration is required.

Verified foundation: `src/conductor/src/engine/daemon.ts:917` declares `let idlePolls = 0`, `:1548` increments it, and `:1549` compares it to `maxIdlePolls`; those three are the only occurrences in the file, so nothing resets it. The increment sits in the fully-idle branch — reached only when a pool slot is free, `pickEligible` returned nothing, and `maintenance.isDrained()` is true (`daemon-maintenance.ts:56` returns `activeWorkCount() === 0`) — so in-flight work never advances the count, and a successful `guardedDispatch` at `:1348` `continue`s past the branch entirely. That makes the successful-dispatch site the single reset point needed for consecutive semantics. `docs/reference/cli.md:293` already promises "consecutive empty polls", so the code is what diverges from the documentation.
