# Intake origin: build-review-severity-definitions-are-duplicated-p

Source-Ref: jstoup111/ai-conductor#3381
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3381 digest=de6e52559b81cc07fc7de0fea2dcab633cde5261f6922429fd6b417b702fcbda >>>
## Desired outcome

- Every build_review rubric dispatch prompt, built-in and custom, presents the same severity definitions word for word.
- A single edit to the severity definitions changes what every rubric reviewer sees. No skill file needs a matching edit.
- No build_review rubric SKILL.md defines the severity scale.
- A newly registered rubric receives the severity definitions without its author adding them.
- A test fails if any registered rubric's dispatch prompt is missing the shared severity definitions or differs from them.
<<< END INBOUND >>>
