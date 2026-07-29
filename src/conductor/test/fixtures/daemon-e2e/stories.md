**Status:** Accepted

# Stories: Daemon E2E fixture feature

## Story: touch the declared fixture file

As a harness maintainer, I want the fixture agent to touch the declared file
so that daemon task evidence can be corroborated against a real commit.

### Acceptance Criteria

- Given the fixture feature is dispatched, when Task 1 runs, then the agent
  touches `test/fixtures/daemon-e2e/touched.txt`.
