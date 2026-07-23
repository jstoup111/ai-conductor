# Plan: Engineer fixture example (headless land)

Track: technical
Tier: M

Fix summary: a minimal, single-task plan the `land` guards accept end-to-end
in one pass inside the sandboxed example harness (`examples/engineer.sh`).

---

### Task 1: Add a trivial marker file

**Story:** Story 1 (Engineer lands a single seeded spec cleanly).

**Type:** feature

**Steps:**
- RED: n/a (fixture-only task; the example harness stubs `conduct-ts` and
  asserts on `land`/`handoff` exit status, not on this file's contents).
- GREEN: Create `MARKER.md` at the repo root with a one-line note that this
  feature shipped.
- COMMIT: `feat: add engineer fixture marker`

**Files:**
- `MARKER.md`

**Dependencies:** none
