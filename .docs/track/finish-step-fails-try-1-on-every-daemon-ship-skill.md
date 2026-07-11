# Track: finish-record primitive — first-try finish-choice marker write (issue #281)

Track: technical

Internal harness reliability fix: daemon auto-mode finish drops the tail marker write
(haiku@low, single print turn, long protocol). Fix mechanizes the STOP-gate checks +
marker writes into a deterministic `conduct-ts finish-record` primitive invoked by the
finish skill's auto-mode exit contract. No product requirements; acceptance criteria
live in stories.
