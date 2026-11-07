# Track: Routed residue finding lands on a taskless host and halts the stack

Track: technical

Scope boundary: All four #3590 desired outcomes. (1) An as-built finding that cites an ADR decision and carries an admitted existing-task binding routes mechanically to its bound task's slice and never reaches the residue judge. (2) A routed audit host with no dispatchable BUILD work at entry settles as a recorded no-op, and the round advances; the no-op halt stays only when no host in the round did work. (3) Recovery for an already-stuck round is `halt clear` re-entering host entry. (4) Negative path: single-candidate residue still routes to its candidate. Excluded: changing the earliest-candidate default for taskless residue (#2940 decision 4b), any new operator CLI, and hand-repairing feature #3579.

Internal engine routing and host-entry behavior with no user-facing product requirements; operator-confirmed 2026-11-05.
