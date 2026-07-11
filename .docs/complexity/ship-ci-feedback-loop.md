# Complexity: ship→CI feedback loop + fixture-portability guards

Tier: M

## Rationale

- **Engine surface (moderate):** extends the existing mergeable sweep (`mergeable-sweep.ts`)
  with CI-rollup interpretation, a `ci-failed` label lifecycle, a bounded per-PR remediation
  attempt counter in the watch registry (state-machine-lite, mirrors `resolveAttempts`), and a
  remediation dispatch off the shipped PR branch — modeled on the existing Task-17
  conflict-autoresolve seam, so no new dispatch architecture.
- **New GitHub API surface (small):** `statusCheckRollup` is already fetched; failing-job log
  excerpt retrieval is the only new read.
- **Second deliverable (small, wide blast radius):** structural fixture-portability meta-test
  (glob-based, falsifiability tests, escape-hatch markers) + remediation of ~16 existing
  non-portable `git init` call sites.
- **Not Large:** no auth, no external models/services, no schema changes, no multi-repo
  coordination; expected story count fits a single-digit set.

Tier M ⇒ architecture-diagram + lightweight architecture-review + conflict-check are all
required before landing.
