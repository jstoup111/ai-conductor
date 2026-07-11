# Stories: REKICK pre-loop rebase records rebase step state (#436)

Source-Ref: jstoup111/ai-conductor#436

## Story 1: successful pre-loop rebase is recorded like the in-loop step

Given a worktree with a `.pipeline/REKICK` sentinel and a resumable feature
When `honorRekick` runs the play-forward rebase and it completes clean or noop
Then the rebase step's recorded state (conduct-state `rebase` key and the
  `.pipeline/gates/rebase.json` verdict) is indistinguishable from the state
  `runRebaseStep` records for the same outcome
And the recording flows through the SAME helper the in-loop step uses
  (observable: one call site each, one shared implementation)
And the downstream kickback verdicts (build/build_review/manual_test) are
  unchanged from today's behavior.

## Story 2 (negative): a conflicted pre-loop rebase records nothing as done

Given the same sentinel setup
When the play-forward rebase re-conflicts and resolution is exhausted
Then the rebase step state is NOT recorded as done (absent or failed, exactly
  as the in-loop conflict path leaves it)
And the existing HALT is written unchanged
And a subsequent operator inspection can distinguish "rebase never ran" from
  "rebase ran and conflicted" from the recorded state alone.

Status: Accepted
