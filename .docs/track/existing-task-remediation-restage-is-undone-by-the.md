# Track: Existing-task remediation restage is undone by the Task-trailer completion union

Track: technical

Scope boundary: Targeted — fix only the interaction between existing-task remediation
restage and the `Task:`-trailer completion union. The #859 false-stall fix and the #647 D1
no-op guard are preserved unchanged. Excluded: evidence-stamp semantics, kickback budgets,
other remediation dispositions, and any broader rework of completion authority (filed
separately as intake).

Engine-internal defect in the remediation route; no user-facing capability or product
requirements, so acceptance criteria live directly in stories and no PRD is authored.
