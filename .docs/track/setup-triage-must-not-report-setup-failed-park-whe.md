# Track: Setup-triage must not report "setup failed"/park when bin/setup succeeded (#582)

Track: technical

Engine correctness fix in the daemon setup-failure triage (`engine/setup-triage.ts` fix-session
stage + `engine/daemon-runner.ts` park rendering). No user-facing product surface — acceptance
criteria live in stories.

## Root cause (verified by direct read)

The #446 triage entered because `bin/setup` initially threw a `SetupFailureError`
(`worktree-prepare.ts:428`). Stage-1 quarantine at 09:39:54 captured only the 3 doc files
**that were dirty at that instant**; it then `reset --hard`ed the tree clean. Stage-2
`fixSession` (`setup-triage.ts:567`) dispatched the LLM fix, then re-ran `runPrepare` — and
`bin/setup` **succeeded** at 09:41:12 (ESM/DTS build success + versionId dist-swap sentinel,
identical shape to a healthy setup). But the re-run / fix left `src/conductor/src/engine/
conductor.ts` modified, so `fixSession`'s clean check (`git status --porcelain`,
`setup-triage.ts:600-610`) found the tree dirty and returned `{kind:'park', outputTail:'',
preservedPaths:[conductor.ts]}`.

Two defects flow from that terminal branch:

1. **The park keys off the residual dirty tree, not the setup exit** (`setup-triage.ts:603-610`).
   A setup-success-with-dirty-tree is rendered by `daemon-runner.ts` exactly like a genuine
   setup failure: the log says `triage outcome: park, erroring feature` (`daemon-runner.ts:251`)
   and, because `outputTail` is empty, the feature reason falls back to the literal
   `'setup failed and parked after triage'` (`daemon-runner.ts:258`) — a false failure-class
   attribution for an environment whose setup verification actually passed.

2. **The residual strays are named but never preserved.** `fixSession`'s `preservedPaths`
   (`setup-triage.ts:608`) is just the dirty-path list — nothing is committed to a ref (unlike
   stage-1 quarantine, `setup-triage.ts:305-383`). `conductor.ts` was not captured because it
   became dirty **after** stage-1 quarantine, during recovery; the fix-session clean step does
   not re-quarantine what it finds. On the next re-dispatch, `ensureWorktree`'s reset could
   silently discard it — the very silent-discard the ADR's preserve-then-heal discipline forbids
   (adr-2026-07-09-setup-failure-triage §Decision.2). #576's wrong-trailer residue makes a
   post-setup stray more likely.

## Scope boundary (deliberate — keeps this non-architectural)

The fix separates the two signals and makes both accurate; it does **not** change the
park→proceed decision. Auto-*proceeding* on a setup-success-with-dirty-tree would remove the
clean-tree half of ADR sub-decision 4's binding success contract ("`bin/setup` exits 0 **AND**
the worktree is clean") and is therefore an ADR amendment, out of scope here. The issue's
desired outcome explicitly authorizes the accurate-park branch — "a feature whose setup
verification passes proceeds **(or is surfaced accurately)** … it is not reported as 'setup
failed'" and "If a dirty tree genuinely must block, the message and outcome say so accurately."
This spec delivers the accurate-park branch: distinct outcome, accurate message, and — honoring
hypothesis #2 — the residual strays are quarantined (ALL uncommitted paths, incl.
tracked-modified `conductor.ts`) so nothing is silently discarded. If the operator later wants
proceed-on-clean-after-capture, that is a separate ADR-gated follow-up.
