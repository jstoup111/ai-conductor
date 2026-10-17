# Intake origin: stacked-features-cannot-be-published-reviewed-and-

Source-Ref: jstoup111/ai-conductor#2945
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2945 digest=a2829cee3c2bc3af66f4a17995905f6e9d24020cdeb552b60c39c7328f4f160e >>>
## Desired outcome

- **Publication.** A stacked feature publishes as a GitHub native stack, one PR per child, in order.
- The top PR is the retained SHIP draft.
- Publication is idempotent and resumable after any interruption, with no duplicate PRs and no different commit pushed for an already-published child.
- The stack is never reported complete just because the leaf succeeded.
- **Every member passes `ci-gate`, `release-metadata`, review and `shipped-record`.** The feature's release note appears exactly once in generated release notes.
- **Only the leaf merging ships the feature.**
- Merging any lower prefix leaves the feature in flight: no shipped-record, intake issue still open, no teardown.
- When the leaf merges, the feature is recorded as shipped exactly once and is never re-dispatched.
- The originating issue closes.
- Every member's diff is verified reachable from `main`, and any missing diff is reported by PR number.
- **Bodies.**
- Each member PR has a reader-facing body describing only its own child, plus stack navigation.
- Feature-wide sections appear only on the leaf: release note, `Closes` reference, `## Migration` (last), and the Cost/Time and build-review blocks.
- Project-owned body regions survive.
- **Concurrent edits.**
- The daemon updates a published stack only when every remote tip matches what it last recorded.
- A server-side rebase after a bottom merge is accepted only after it is verified.
- Any other mismatch halts with a dedicated, sweep-skipped halt class and a documented recovery command. It never re-kicks in a loop.
- **Routed fixes and red CI.** A routed fix to an already-published child leaves a comment on that PR saying what changed. Red CI on an intermediate member is surfaced for a human decision and never self-resolved.
- **Lifecycle visibility.** A non-leaf member seen merged, closed or reverted is observable on the event spine.
- **Teardown and reclaim** remove all of a feature's child branches, and only after the leaf merges.
- **The engine never merges a member** and never disables, toggles or bypasses a ruleset. Pushes never use a plain force-push.
- **Single-PR features** publish as an ordinary PR, exactly as today.
<<< END INBOUND >>>
