**Status:** Accepted

# Stories: Unassigning a captured intake issue does not withdraw it from claim

Source-Ref: jstoup111/ai-conductor#3540. Track: technical (no PRD). Tier: S.

Scope boundary (from `.docs/track/unassigning-a-captured-intake-issue-does-not-withd.md`): only
`compose claim` serving `github-issues` candidates. The "machine owner" is the identity the existing
resolver chain returns (`spec_owner` from the user config, else the `gh` login), the same identity
intake write-back authorization already uses. An issue is "assigned to the machine owner" when the
owner's login is among the issue's current GitHub assignees, compared case-insensitively. A
candidate is "skipped" when claim does not serve it on this call but leaves its ledger entry and its
inbox envelope `pending`.

Today capture filters by assignee, but after capture nothing re-checks assignment: claim serves a
captured issue from the pending queue, from a stale-claim reap, or from an `unclaim`/`requeue`
recovery even after the operator has unassigned themselves (observed on
jstoup111/ai-conductor#1935, 2026-10-29).

## Story 1: Claim skips a captured issue the machine owner is no longer assigned to

**Requirement:** #3540 desired outcomes 1, 4

As the operator, I want unassigning myself from a captured issue to stop `compose claim` from
handing it to me, so that I can withdraw an issue from composer intake from GitHub alone.

### Acceptance Criteria

#### Happy Path
- Given the inbox holds one pending `github-issues` envelope for an open issue whose current assignees do not include the machine owner, when `compose claim` runs, then it prints `{"kind":"claim","empty":true}` and exits 0.
- Given that skip, when claim finishes, then stderr contains one line naming the issue reference and stating it was skipped because it is not assigned to the machine owner, naming the owner login.
- Given an unassigned open issue whose ledger entry was `claimed` past the stale-claim window, when `compose claim` reaps it back to `pending`, then claim does not serve it and stderr reports the same not-assigned skip for that reference.
- Given an unassigned open issue that `compose unclaim` or `compose requeue --stale` returned to `pending`, when `compose claim` runs, then claim does not serve it and stderr reports the same not-assigned skip for that reference.

#### Negative Paths
- Given the inbox holds an unassigned issue received before an assigned issue in the same priority band, when `compose claim` runs, then it serves the assigned issue and still reports the not-assigned skip for the unassigned one.
- Given a skipped issue, when claim finishes, then its ledger entry is still `pending` with an unchanged `attempts` count, its inbox envelope is pending (not `.claimed`, not deleted), and no claim record is written for it.
- Given an issue that is both closed and unassigned, when `compose claim` runs, then it is forgotten and dropped exactly as a closed issue is today, and no not-assigned skip is reported for it.

### Done When
- [ ] A test driving the real `dispatchEngineer` claim entry point against a real file queue and ledger, with only `gh` and the owner resolver faked, observes the empty claim output, the stderr skip line naming reference, reason, and owner, the `pending` ledger entry with unchanged attempts, and the pending envelope.
- [ ] The same entry point, seeded once with a stale `claimed` entry and once with an `unclaim`-recovered entry for an unassigned issue, observes no served claim and the not-assigned skip line in both cases.

## Story 2: Reassignment restores the issue, and assigned issues are claimed as today

**Requirement:** #3540 desired outcomes 2, 3

As the operator, I want reassigning an issue to myself to bring it back to claim with no manual
ledger edit, and issues I am still assigned to to behave exactly as before.

### Acceptance Criteria

#### Happy Path
- Given an issue that a previous `compose claim` skipped as not assigned, when the operator is reassigned and `compose claim` runs again, then claim serves that issue with the same `kind`, `text`, `source`, and `sourceRef` output as any served claim and its ledger entry becomes `claimed`.
- Given a pending issue whose current assignees include the machine owner and another user, when `compose claim` runs, then claim serves it.
- Given a pending issue assigned to the machine owner where the GitHub login and the resolved owner differ only in letter case, when `compose claim` runs, then claim serves it.

#### Negative Paths
- Given only issues assigned to the machine owner are pending, when `compose claim` runs, then the served issue, its output, its ledger transition, and its claim record are the same as before this change, and stderr contains no not-assigned or assignment-unknown skip line.
- Given a pending envelope from a source other than `github-issues`, when `compose claim` runs, then no assignment read is made for it and it is served as today.

### Done When
- [ ] A real-entry-point test runs claim twice against the same queue and ledger, flipping the faked assignees between runs, and observes empty-then-served output and the ledger moving `pending` to `claimed` with no ledger edit between runs.
- [ ] Real-entry-point tests observe a co-assigned issue and a case-differing login both served with no skip line, and a non-`github-issues` envelope served with no `gh issue view` assignees call recorded by the fake.

## Story 3: An unreadable assignment is reported and kept, never served or dropped

**Requirement:** #3540 desired outcome 5

As the operator, I want claim to tell me when it could not confirm an issue's assignment, so that a
`gh` or network failure neither hands me a withdrawn issue nor silently loses one.

### Acceptance Criteria

#### Happy Path
- Given a pending open issue whose assignees read fails (the `gh` call throws or returns output that is not a JSON object with an assignees array of logins), when `compose claim` runs, then claim does not serve it and stderr contains one line naming the issue reference and stating its assignment is unknown.
- Given the machine owner cannot be resolved (no `spec_owner` and no `gh` login), when `compose claim` runs with a pending `github-issues` issue, then claim does not serve it and stderr reports the assignment as unknown because the owner is unresolved.

#### Negative Paths
- Given an assignment-unknown skip, when claim finishes, then the ledger entry is still `pending` with unchanged attempts and the envelope is pending, so a later claim with a readable assignment serves it.
- Given an assignment-unknown skip, when claim finishes, then the ledger still holds an entry for that reference and no GitHub write (comment, label, close, or assignee change) was made.

### Done When
- [ ] Real-entry-point tests with a throwing assignees read, a malformed assignees payload, and an unresolved owner each observe the empty claim output, the assignment-unknown stderr line naming the reference, and the `pending` ledger entry and envelope.
- [ ] A follow-up claim in the same test with a readable owner-assigned payload serves the issue, and the fake `gh` records no write call across both runs.
