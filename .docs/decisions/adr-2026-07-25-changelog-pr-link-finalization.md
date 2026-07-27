# ADR: Finish resolves an exact changelog implementation-PR token

**Date:** 2026-07-25
**Status:** APPROVED
**Deciders:** Project operator and maintain-documentation architecture review

## Context

The documentation gate runs before `finish`, while `finish` creates or reuses the implementation
pull request. A changelog entry therefore cannot contain the required implementation PR number and
URL when documentation is committed. Moving PR creation earlier would change the repository's
shipping lifecycle and PR-timing contract.

The resolution step is mechanical and load-bearing. It must not depend on free-form editing by the
finish model, and it must not make `finish` depend on a documentation step in other projects.

## Options Considered

### Option A: Omit the implementation PR link

- **Pros:** No finish change.
- **Cons:** Violates the approved changelog contract.

### Option B: Create the implementation PR before documentation review

- **Pros:** The final URL is known when the changelog entry is authored.
- **Cons:** Changes PR timing and expands the documentation step's external authority.

### Option C: Resolve an exact token after PR creation

- **Pros:** Preserves current PR timing; replacement is deterministic; absent tokens are a no-op.
- **Cons:** Adds one small CLI primitive and a post-PR documentation commit.

## Decision

Choose Option C.

1. A notable changelog entry authored before finish uses the exact token
   `{{IMPLEMENTATION_PR}}` in place of its implementation PR link.
2. Add `conduct-ts finalize-changelog-pr --pr-url <url>`. It validates a canonical GitHub pull
   request URL, extracts the PR number, and replaces exactly one token in `CHANGELOG.md` with
   `[implementation PR #N](<url>)`.
3. No token is a successful no-op. Multiple tokens, an invalid URL, an unreadable changelog, or a
   write failure returns non-zero without partial replacement.
4. After `/pr` returns the URL, `finish` invokes the primitive. When the changelog changes,
   `finish` commits and pushes that focused change before the existing shipped-record and
   finish-record sequence.
5. A finalization failure is a finish refusal: no shipped record and no `finish-choice` are
   written in that pass.

## Consequences

### Positive

- Final changelog entries contain the implementation PR without changing PR timing.
- Projects without the exact token keep the existing finish path.
- Replacement and failure behavior are unit-testable.

### Negative

- PR shipments with a token gain one small commit and push.
- The implementation PR initially exists before the final changelog commit reaches its branch.

### Follow-up Actions

- [ ] Implement and register the CLI primitive.
- [ ] Add no-op, replacement, malformed, duplicate-token, and real-dispatch tests.
- [ ] Add the conditional call and STOP contract to `finish`.
