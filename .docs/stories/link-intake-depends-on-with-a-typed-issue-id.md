**Status:** Accepted

# Stories: Link intake depends-on with a typed issue id (#2714)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is the registered dependency-add request shape, the tracker client's dependency add, and the intake filer's report of links it could not record. Filing still exits 0 once the issue is created.

## Story 1: Dependency links carry a typed issue id

As an operator filing intake with `--depends-on`, I want the blocked-by link sent in the shape GitHub accepts so that the new issue shows its blocker immediately.

### Acceptance Criteria

#### Happy Path

- Given an intake filed with one `--depends-on owner/repo#N` whose issue id resolves, when the filing records the link, then the blocked-by request sends that id as a typed integer field and the filing reports the dependency as linked.
- Given the dependency migration records a blocked-by edge whose issue id resolves, when it posts the link, then the request sends that id as the same typed integer field.

#### Negative Paths

- Given a registered dependency-add request that carries no resolved issue id, when it is translated for GitHub, then it is refused before any blocked-by request is sent and no issue-number field is ever sent.

### Done When

- [ ] The intake filing and dependency migration fixtures observe the id as a typed `-F issue_id=<id>` pair at the GitHub boundary.
- [ ] A dependency-add request with no id reaches no blocked-by call and fails with an error naming the missing id.

## Story 2: The tracker client exposes no unused dependency-add method

As an engine maintainer, I want the tracker client's unused dependency-add method removed so that no unreachable path can send a rejected request form.

### Acceptance Criteria

#### Happy Path

- Given the GitHub tracker client is constructed, when a caller inspects it, then it exposes no addIssueDependency method.

#### Negative Paths

- Given the guarded issue-mutation suite runs against owned and foreign issues, when it completes, then the transport records no blocked-by POST from the tracker client.

### Done When

- [ ] A tracker-client fixture asserts the constructed client has no addIssueDependency method.
- [ ] The guarded issue-mutation fixture records no blocked-by POST.

## Story 3: The filer names every missing link

As an operator reading the filer's output, I want a failed dependency link to be impossible to overlook so that a missing blocker is never discovered later by accident.

### Acceptance Criteria

#### Happy Path

- Given a filing whose issue is created and whose every `--depends-on` link is recorded, when the filer finishes, then it prints the linked references and prints no not-linked line.

#### Negative Paths

- Given a filing whose issue is created but one `--depends-on` link is rejected by GitHub, when the filer finishes, then its final output line names the filed issue URL, the unlinked `owner/repo#N`, and the rejection reason, and the filer still exits 0.
- Given a filing whose `--depends-on` issue id cannot be read, when the filer finishes, then a final not-linked line names that reference and the read failure while every recorded link is still reported as linked.

### Done When

- [ ] The filing result lists each unrecorded dependency with its reference and reason, separately from warnings.
- [ ] The real filer CLI, run against a stub GitHub CLI, ends its output with one not-linked line per unrecorded dependency and exits 0.

## Negative-category review

Invalid input: a request without a resolved id is refused before transport (Story 1). Dependency unavailability and network errors: an unreadable blocking issue is reported by the filer (Story 3). Partial failure: the issue is already created when a link fails, so there is no rollback; the filer reports the missing link and keeps the created issue (Story 3). Auth/permission: the existing guarded-runner ownership refusals are unchanged and already covered. Concurrency, resource exhaustion, deletion, immutability, and idempotency are inapplicable: each filing posts each link once and deletes nothing.
