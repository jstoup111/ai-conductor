# Intake origin: amendment-notes-in-common-header-forms-are-invisib

Source-Ref: jstoup111/ai-conductor#2982
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2982 digest=80bc6d926d0020b05d63d18dc1dc1324674e1e3573c3c98b4315f8e2085ecc38 >>>
## Desired outcome

- An amendment note written in any header form already present in the corpus becomes an amendment claim. Otherwise, authoring a form the extractor cannot read is refused at land, naming the file and line.
- No amendment note in a spec's DECIDE set is silently ignored by `coverage_binding`.
- A blockquote that is not an amendment note is still never treated as one.
<<< END INBOUND >>>
