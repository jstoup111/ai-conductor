# Intake origin: manual-reviewer-edits-cannot-be-landed-safely-in-t

Source-Ref: jstoup111/ai-conductor#3203
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3203 digest=e0f314e2eb39a0a486d3cb1f62457d4a380e7bed593cc9fadf2b7a283765b75a >>>
## Desired outcome

- A human or agent with a manual change can get it landed in the child that owns it, without hand-editing branches.
- A commit made on the wrong child during a manual landing is refused, whether or not it carries a `Task:` trailer.
- A manual change in a closed child is never closed over before the person landing it declares it complete.
- After a manual landing, the changed child and every closed child above it are re-validated, then the leaf whole-feature gates re-run. This uses the same guarantees #2944 gives routed audit fixes.
- `rewind --child <k>` on a closed child is no longer refused. It re-opens that child's work safely, with the same guarantees.
- A manual landing cannot start while the daemon could dispatch the feature, or while another repair or restack is in flight.
- N=1 features and unsliced plans behave exactly as today.
<<< END INBOUND >>>
