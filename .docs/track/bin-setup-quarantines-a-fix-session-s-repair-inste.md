# Track: Setup fix-session repairs must converge (#1346)

Track: technical

Scope boundary: In daemon setup-failure triage only, capture the exact clean-tree changes made by
the bounded fix-session, verify that a forced setup run succeeds without adding or altering that
captured change set, and mechanically commit the verified repair. Preserve and clearly surface any
off-contract drift instead of committing it. General BUILD task commits, manual conduct runs, and
the project setup contract are unchanged.

This is an internal daemon-recovery correctness change with no product-facing requirements;
acceptance criteria belong directly in stories.
