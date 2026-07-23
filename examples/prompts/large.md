# Large: Team notifications for shared task lists

Add multi-user sharing and notifications to the task list feature: a user can share a task
list with teammates, and teammates get notified when a shared task changes.

## Story 1 — Share a task list with a teammate

As a task list owner, I want to share my list with another user by email/username so we
can collaborate on the same tasks.

- Given I own a task list, when I share it with a valid existing user, then that user gains
  read/write access to the list.
- Given I try to share with a user that doesn't exist, when I submit the share request,
  then I get a clear error and no share record is created.
- Given a list is already shared with a user, when I share it again with the same user,
  then the operation is idempotent (no duplicate share record).

## Story 2 — View and manage who a list is shared with

As a task list owner, I want to see everyone a list is shared with and revoke access.

- Given a list has two collaborators, when I view the list's sharing settings, then both
  are listed with their access level.
- Given I revoke a collaborator's access, when they next try to view/edit the list, then
  they are denied.

## Story 3 — Notify collaborators on task changes

As a collaborator, I want to be notified when a shared task I care about changes status.

- Given I have access to a shared list, when another collaborator marks a task done, then
  I receive a notification (in-app and/or email) referencing the task and who changed it.
- Given I made the change myself, when a task I edited changes, then I do NOT get notified
  about my own edit.
- Given the notification channel is unavailable (e.g. email service down), when a
  notification fails to send, then the task change itself still succeeds and the failure is
  logged, not silently dropped and not blocking the write.

## Story 4 — Access control on shared tasks

As the system, I want to enforce that only owners and collaborators can read/write a
shared list's tasks.

- Given a user with no access to a list, when they attempt to read or modify a task on it,
  then the request is rejected (403/permission error), not a silent empty result.
- Given a collaborator with read-only access (if that access level exists), when they
  attempt to edit a task, then the edit is rejected.

## Acceptance

- All four stories' happy and negative paths are covered by tests.
- Sharing, revocation, and notification are each independently testable (unit) and the
  end-to-end flow (share → edit → notify → revoke → denied) has at least one integration
  test.

Sized as a multi-story feature spanning data model changes (share records, access levels),
a new notification mechanism, and access-control enforcement — appropriate for a full
engineer/DECIDE→BUILD pass or a daemon-driven multi-task plan, not a single inline task.
