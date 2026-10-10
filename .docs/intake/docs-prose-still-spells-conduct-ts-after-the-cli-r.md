# Intake origin: docs-prose-still-spells-conduct-ts-after-the-cli-r

Source-Ref: jstoup111/ai-conductor#2028
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2028 digest=5e049cb6f4aca7baf29d34c0c4e6cbd4eaee6e726436eee6f09894488318eca4 >>>
## Desired outcome

- A reader following any page under `docs/` types `ai-conductor` and never receives a deprecation warning for a command the documentation told them to run.
- The surviving `conduct-ts` occurrences across `docs/` are exactly the ones that document the deprecated alias itself — its existence, its warning, and the migration away from it.
- The repository's legacy-CLI guard covers `docs/`, so a `conduct-ts` reference reintroduced into documentation fails a test rather than being noticed by a reader.
- Prose that describes the idea-to-spec loop names the canonical `compose` verb and the `composer` skill, with `engineer` appearing only where the deprecated alias is the subject.
- `daemon` wording is untouched — the ADR keeps that name deliberately.
<<< END INBOUND >>>
