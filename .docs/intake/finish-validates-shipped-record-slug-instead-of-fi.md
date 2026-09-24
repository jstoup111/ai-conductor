# Intake origin: finish-validates-shipped-record-slug-instead-of-fi

Source-Ref: jstoup111/ai-conductor#1647
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1647 digest=242bad8d7956158dbe8cb31b5cdb093a48a9faf76bf92654c4ff5bba4331df0d >>>
## Desired outcome

- FINISH distinguishes a valid shipped record from one that exists but does not correspond to this
- When the record is present but not valid, the run reaches the human-required disposition already
- Negative path: a healthy record still reads valid with no added dispatch, and a missing record
- No branch remains in the publication coordinator that production cannot reach.
<<< END INBOUND >>>
