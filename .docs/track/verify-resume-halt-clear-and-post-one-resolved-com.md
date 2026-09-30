# Track: Verify resume halt clear and post one resolved comment

Track: technical

Scope boundary: Small fix for #2883, approved by the operator on 2026-09-30 (delegated). The resume-time halt clear re-reads the PR after its guarded writes and posts the "Halt resolved" note only when that read shows no halt signal, and it supersedes the existing marked remediation comment instead of creating a new one on every resume. FINISH's publication guard, the halt-open path, the finish-time rehabilitation, and the legacy raw-gh cleanup path are unchanged.

Most of the observed defect (title prefix and banner surviving a resolved halt) was fixed on main by #2865 after the daemon's running dist was built; this slice closes the remaining gap: the operations path trusts write results without confirming the PR state, and it creates a new comment on every successful clear.

Scope check: A — harness-repo-only engine behaviour (self-host halt PR rehabilitation); B — n/a (no new skill); C — provider-agnostic. Event-spine: no new channel; the existing log lines and outcome values are reused.

Verified foundation: halt-pr-rehabilitation.ts clearHaltStateForResume gates on hasHaltSignal, issues label removal, title edit, and body edit through rehabilitateMutation, then unconditionally issues pull-request.comment.create with NEEDS_REMEDIATION_MARKER; it never re-reads the PR. pr-labels.ts upsertComment already implements find-by-marker then pull-request.comment.update for the legacy path. github-operations.ts registers pull-request.comment.update with a commentId and body payload. conductor.ts calls clearHaltStateForResume once per run and retries only on partial.
