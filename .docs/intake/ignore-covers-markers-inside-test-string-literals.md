# Intake origin: ignore-covers-markers-inside-test-string-literals

Source-Ref: jstoup111/ai-conductor#2597
Owner: jstoup111

## Desired outcome
- Text inside a string or template literal is never reported as a test's obligation reference.
- A test with no marker of its own and a file-level marker resolves to the file-level marker's obligations.
- A genuinely unmarked test is still reported as unresolved.
- A scope-incomplete halt names the test file and line in the HALT body, not only in build-review.json.
