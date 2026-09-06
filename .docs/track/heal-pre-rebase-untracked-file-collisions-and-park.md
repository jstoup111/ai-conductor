# Track: Heal pre-rebase untracked-file collisions and park them accurately

Track: technical

Scope boundary: Small fix for #415, approved by the operator on 2026-09-06 (delegated). Scope is
`performRebase`'s failure branch when git refuses to start a rebase at all: recognise the
untracked-working-tree-collision class, quarantine the named untracked files non-destructively,
retry the rebase exactly once, and — when no heal is possible — park with a diagnosis that does not
instruct a resume procedure that cannot work. Out of scope: any change to the gated `/rebase`
resolution sub-loop's contract, the LLM resolver skill text, gate invalidation, other pre-start
refusal classes that need their own remedy (dirty-tree refusals autostash already covers, protected
artifact seal refusals, which have their own halt writer), automatic restoration of quarantined
files, and any new configuration key.

This is an internal engine correction to daemon rebase machinery; acceptance criteria live in
technical stories rather than a PRD.

The operator approved deterministic quarantine-and-retry over the two rejected alternatives on
2026-09-06 (delegated): deleting the colliding untracked files (destructive, and unrecoverable when
the file was genuine unfinished work) and routing the outcome into the LLM `/rebase` resolver
(whose entire contract is completing a paused rebase with `git rebase --continue`, which does not
exist in this state). `resolveRebaseConflicts`'s `onto === null` early return is therefore correct
and is deliberately left in place; the defect is that nothing else happened before it.

Scope check: A — consumer-facing. The mechanism is `performRebase`, the engine's rebase step, which
runs in any repository that installs the harness and runs the daemon; it is not gated behind
`isSelfBuild()` and depends on no convention private to this repository. Documentation therefore
belongs under `docs/`, and no `HARNESS.md` rule is added because this change adds behaviour, not a
rule. B — n/a, no new skill. C — provider-agnostic: the heal is engine-native git handling with no
provider path, environment variable, or host-specific flag.

Event spine: Channel? yes — the quarantine is an occurrence a daemon operator needs to know about.
Concern: occurrence (a file was moved aside during a rebase), not durable state. Verdict: extend the
union with one variant emitted through the existing `emitRebaseEvent` bridge. Exception: none — no
separate write location is introduced. The quarantine directory itself holds the moved bytes, which
are the payload, not an observation, and it is not a second telemetry format.

Verified foundation: `src/conductor/src/engine/rebase.ts` still carries the exact code the issue
cites. `performRebase` runs `git rebase --autostash <base>` and, on a non-zero exit with no unmerged
paths, returns `{ kind: 'conflict_halt', conflicts: [], reason: <raw git stderr> }`.
`resolveRebaseConflicts` reads `rebase-merge/onto` and `rebase-apply/onto`, and returns the incoming
outcome untouched when neither exists, so the resolver is never dispatched. `runGatedRebaseResolution`
delegates to it, so both the finish-time path in `conductor.ts` and the play-forward
`resumeRebaseFirst` path in `daemon-rekick.ts` inherit the no-op. Both of those call sites then call
`writeHalt`, whose note is a fixed "Resolve the conflicts … git rebase --continue" procedure.
`writeSealHalt` in the same file is the existing precedent for a pre-rebase refusal that gets its
own accurate note. Reproduced on git 2.53.0 in a throwaway repository: an untracked file colliding
with a path the base introduced as tracked makes `git rebase --autostash main` exit 1 with "error:
The following untracked working tree files would be overwritten by checkout", leaves no
`rebase-merge` or `rebase-apply` directory, reports no unmerged paths, and rebases cleanly after the
colliding file is moved aside.
