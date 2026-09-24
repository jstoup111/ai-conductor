# Track: FINISH validates shipped-record slug instead of file existence

Track: technical

Scope boundary: Small. The FINISH shipped-record observer resolves the record path via the writer's canonical shipment identity (`resolveShipmentIdentity`) and validates the record's frontmatter `slug` against it. A missing, mismatched, or unparseable slug is `malformed`, which reaches the existing `invalid_shipped_record` human-required disposition. Excluded: `specHash` and `pr` validation, pushed-state checks, and any change to the shipped-record writer or CI check.

Internal engine validation with no user-facing behavior; it also closes the dated-plan path asymmetry between writer and observer.
