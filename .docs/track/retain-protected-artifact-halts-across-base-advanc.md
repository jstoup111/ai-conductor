# Track: Retain protected-artifact halts across base-advance sweeps

Track: technical

Scope boundary: Complete issue #2199's four desired outcomes: retain protected-artifact halts on every sweep until operator recovery, identify the retained disposition in the existing log, preserve mechanical/legacy retry behavior, and require an explicit tested disposition for every halt class. No seal rotation, migration, new halt class, or other recovery policy changes.

This repairs an internal daemon retry-eligibility omission under the existing protected-artifact safety contract. The operator authorized complete unambiguous S specifications in this batch on 2026-09-05; unresolved implementation choices must halt DECIDE.

Scope check: harness-repo-only (daemon machinery); catalog n/a; provider agnostic. Registration: none.
