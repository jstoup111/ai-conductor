# Intake origin: validate-the-shipped-record-finish-observes-instea

Source-Ref: jstoup111/ai-conductor#1647
Owner: jstoup111

## Desired outcome
- FINISH distinguishes a valid shipped record from one that exists but does not correspond to this
  feature and this shipment, rather than accepting file existence as proof.
- When the record is present but not valid, the run reaches the human-required disposition already
  written for it instead of publishing past it.
- Negative path: a healthy record still reads valid with no added dispatch, and a missing record
  still routes to `write_shipped_record` exactly as today.
- No branch remains in the publication coordinator that production cannot reach.
