---
title: FAQ
parent: Guides
nav_order: 2
---

# FAQ

Short answers to the questions engineers ask most in their first weeks with the harness. The
reasoning behind each answer is in [Working effectively](working-effectively.md).

**The build is taking a long time. Should I check on it?**
Run `ai-conductor daemon status`. If the feature's badge is `● running` and nothing is in
`BLOCKED`, it is working. Long builds are usually review laps, which are self-correcting. The
median feature takes about 90 minutes of active time; a few hours is not unusual for a Large tier.

**I want to see what it is doing so I can catch mistakes early.**
The gates catch mistakes against the plan you merged. The earliest place to catch them is the
spec PR: read the stories and the plan's `Done when:` bullets carefully before merging. A mistake
in the plan will be faithfully built.

**Can I make a small tweak to the feature branch while it is building?**
Park it first, make the change inside the plan's scope, commit, unpark. Or wait for
ready-for-review and push like any PR. See [When you can touch the code](working-effectively.md#when-you-can-touch-the-code).

**The spec is wrong and the build has already started.**
Cheapest: let it finish, reject the PR, file an intake issue. If it is heading somewhere expensive:
park, amend the spec artifacts, reseal, unpark.

**I have five small related changes. Five specs or one?**
One spec with five stories. Each spec pays the full DECIDE and SHIP overhead; stories inside a
spec share it.

**Can I skip DECIDE and have it build from a sentence?**
The plan is what the gates grade against. A one-sentence plan gives the build nothing to check
itself against, which is how you get confident, wrong code. The composer makes DECIDE fast; let it.

**The daemon opened a PR I disagree with.**
Review it and request changes, exactly as you would for a colleague's PR. If the whole direction
is wrong, follow [abandoning a spec](../runbooks/abandoning-a-spec.md) rather than just closing
it, so the daemon does not re-dispatch the feature.

**Something halted and the remedy text does not help.**
Run `/daemon-triage`. If that does not resolve it, it is an intake issue: [intake.md](intake.md)
explains how to file one with the evidence the next DECIDE needs.

**Why doesn't it ask me when it is unsure?**
It does, by halting `needs-human` with the assumption it could not resolve. That is its only
interruption, on purpose. Anything below that threshold it resolves from the spec, which is why
the spec is where your attention pays off most.
