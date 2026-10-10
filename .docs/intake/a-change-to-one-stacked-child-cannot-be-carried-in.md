# Intake origin: a-change-to-one-stacked-child-cannot-be-carried-in

Source-Ref: jstoup111/ai-conductor#2943
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2943 digest=7a416c197449a747659f4422c0a387f1a5b49a9949ae5d635faba1a421981f02 >>>
## Desired outcome

- **Own changes only.** After child k changes, every child above it is rebased onto the new tip. Each child's own changes are preserved, and no parent commits are replayed into it.
- **Conflicts halt.** A restack conflict the harness cannot resolve halts, naming the child and the conflicting commits. Both the parent's and the child's intended commits stay recoverable.
- **Verified results.** Every restack is checked by its result (branch tips, ancestry and trees), never by a command's exit status. A push that would overwrite a remote ref whose tip is not the one the engine recorded is refused.
- **Fresh-base refresh.** It moves child 1 onto the current default branch and restacks the rest, with the same guarantees.
- **Refunds only for default-branch refreshes.** A restack caused by a routed fix inside the feature does not refund `build_review` convergence laps. A default-branch refresh behaves as today.
- **Per-child cascade cap.** Repeated restack cascades into one child are bounded per child. Exhausting the bound halts with the child named.
- **Recovery goes through the same path.** Daemon re-kick and interrupted-operation recovery on a stacked feature use this restack path, never a single-branch rebase.
- **N=1 rebases** behave exactly as today.
<<< END INBOUND >>>
