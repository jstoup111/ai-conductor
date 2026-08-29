# Complexity: v1.0 cutover — remove bin/conduct, make the TS CLI the only CLI

Tier: M

Rationale: No new models, integrations, auth, or state machines — but the change removes a
long-lived entry surface (installer symlink swap, deletion of a 3,237-line script and its
dedicated tests, a repo-wide forward-facing reference sweep, and a guard-test extension), spans
bin/, test/, docs/, and skills/, and carries a MAJOR release disposition. Too broad for Small;
no novel design for Large.
