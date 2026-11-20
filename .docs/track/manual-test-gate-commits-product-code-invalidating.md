# Track: Protect product code during SHIP validation

Track: technical

Scope boundary: The engine protects product code during manual_test, prd_audit and architecture_review_as_built. When the host cannot establish protection, emit a prominent operator warning before dispatch and continue automatically. A fallback run must still send changed product code through the normal build and review gates. Each validator can write its harness-owned evidence under .pipeline/. When a validator finds a product defect, it reports the finding for repair through BUILD, test_suite and build_review. When the code changes during parallel validation, the engine automatically reruns the validators whose verdicts became stale.

The operator approved this scope for jstoup111/ai-conductor#3685. The change concerns enforcement and recovery in the harness. A commit guard alone leaves edits visible to sibling validators before a commit, so protection must cover the working tree as well as commits.
