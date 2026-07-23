# Plan: Daemon fixture example (headless drain)

Track: technical
Tier: S

Fix summary: a minimal, single-task plan the daemon can drain end-to-end in
one pass inside the sandboxed example harness (`examples/daemon.sh`).

---

### Task 1: Add a trivial marker file

**Story:** Story 1 (Daemon drains a single seeded feature to DONE).

**Type:** feature

**Steps:**
- RED: n/a (fixture-only task; the example harness stubs `conduct-ts` and
  asserts on daemon exit status, not on this file's contents).
- GREEN: Create `MARKER.md` at the repo root with a one-line note that this
  feature shipped.
- COMMIT: `feat: add daemon fixture marker`

**Files:**
- `MARKER.md`

**Dependencies:** none
