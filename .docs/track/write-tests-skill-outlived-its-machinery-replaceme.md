# Track: write-tests skill outlived its machinery replacement and is half-wired

Track: technical

Change class: refactor

Scope boundary: Balanced (operator-confirmed 2026-10-29). Keep `.agents/skills/write-tests/`; cut only
the guidance that CI machinery already enforces (§8 typecheck/lint covering tests → CI `typecheck:test`
and `lint` jobs) or that contradicts `HARNESS.md` test-suite ownership (§8 "run aggregate before
handoff", §9 step 7); keep the judgment sections (§1–§7, §9 diagnosis) binding and name partial
backstops (`AI_CONDUCTOR_NO_REAL_EXEC`, leak guards) where they exist; add the missing
`.claude/skills/write-tests` symlink; add an integrity check that every `.agents/skills/<name>/` has a
resolving `.claude/skills/<name>` symlink and `agents/openai.yaml`, and no orphaned symlink. Excluded:
removing the skill, repointing the merged plans that cite it, converting partially enforced rules
(e.g. a general real-external-spawn ban) into new machinery, and a directory-level `.claude/skills`
symlink.

Repository-local test guidance and an integrity check; no user-facing behavior, so no PRD.
