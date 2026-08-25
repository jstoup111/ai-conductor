# Track: prd-audit-halts-on-a-stale-report-when-the-audit-d

Track: technical

Scope boundary: All SHIP-tail verdict gates (prd_audit, architecture_review_as_built, manual_test; build_review's existing lapId mechanism untouched). Run-identity verdict contract (engine-issued per-dispatch run id stamped into report + marker, matched by every reader including classify/halt paths), engine-verified write handshake after each audit dispatch, bounded retry then a halt naming the artifact and expected/found identity, and recovery that never requires hand-deleting .pipeline files. Root-causing the specific attempt-14 non-write is best-effort, not a blocker.

Gate/engine machinery with no product-facing behavior; operator-visible changes are diagnostic halt text only.
