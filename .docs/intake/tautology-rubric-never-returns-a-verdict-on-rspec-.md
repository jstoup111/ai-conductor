# Intake origin: tautology-rubric-never-returns-a-verdict-on-rspec-

Source-Ref: jstoup111/ai-conductor#1682
Owner: jstoup111

## Desired outcome

- A scoped run whose output reports RSpec example failures is classified as a test
- A scoped run that genuinely fails to load its spec files is still classified
- A scoped run that matched no executable test is still classified as such — no
- The tautology rubric returns a judged verdict, pass or fail, on an RSpec project
- When a scoped run does end in an infrastructure failure, its stdout and stderr remain
