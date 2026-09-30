**Status:** Accepted

# Stories: Verify resume halt clear and post one resolved comment (#2883)

Track: technical

Tier: S

Approved by the operator on 2026-09-30 (delegated). Scope is the operations path of the resume-time halt clear.

## Story 1: Report a resolved halt only after the PR shows no halt signal

### Acceptance Criteria

#### Happy Path

- Given a resumed feature's PR carries the remediation label, title prefix, body marker, and halt banner, when the resume clear's guarded writes succeed and the follow-up read shows none of them, then the outcome is cleared and the PR passes the FINISH halt-signal check.

#### Negative Paths

- Given every guarded write reports executed but the follow-up read still shows a halt signal, when the resume clear finishes, then the outcome is partial and no resolution comment is written.
- Given the follow-up read fails, when the resume clear finishes, then the outcome is partial and no resolution comment is written.

### Done When

- [ ] A unit fixture whose fake GitHub state applies the writes returns cleared and a post-clear view that hasHaltSignal rejects.
- [ ] Unit fixtures for a no-op write and a failed re-read return partial with zero comment writes.

## Story 2: Keep one resolution comment per PR

### Acceptance Criteria

#### Happy Path

- Given the PR already has a comment carrying the remediation marker, when a resume clear is confirmed, then that comment is updated in place to the resolution note and no new comment is created.

#### Negative Paths

- Given a resume clear was confirmed earlier and the PR now shows no halt signal, when a later resume runs the clear again, then it returns not-halted and writes no comment.
- Given the comment lookup fails after a confirmed clear, when the resume clear posts its note, then it creates exactly one new comment and still returns cleared only if that write executed.

### Done When

- [ ] A unit fixture with an existing marked comment observes one pull-request.comment.update with the resolution note and zero pull-request.comment.create writes.
- [ ] A repeated-resume fixture observes zero writes on the second call.

## Negative-category review

Write results that lie and failed reads cover dependency and integrity failures; a failed comment lookup covers partial dependency failure; the repeated resume covers idempotency. Permission refusals keep the existing refused outcome. No deletion, queue, datastore, upload, or transaction is introduced; those categories are inapplicable.
