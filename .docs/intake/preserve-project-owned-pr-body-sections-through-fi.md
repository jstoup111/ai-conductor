# Intake origin: preserve-project-owned-pr-body-sections-through-fi

Source-Ref: jstoup111/ai-conductor#2616
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2616 digest=798bf4389ebf4a4c325f84bf094c7559791c6e97fde627a5f6a61ec9b2c86c7a >>>
## Desired outcome

- A project-declared step's contribution to the pull request body is still present, byte-for-byte, in the body after `finish` completes.
- If that contribution is missing after the step reported success, the run stops with an operator-visible reason naming the step — it is never silently dropped.
- The engine does not need to understand the contents of a project-owned contribution; a format the engine has never seen is preserved the same as any other.
- A project can use its own pull request template and section names without an engine change.
- This repository's `## Release metadata` block keeps surviving `finish`, and its release workflows keep reading it, with no engine code that recognizes the `Release-*` field names.
- Negative path: a repository that declares no project-owned body content gets exactly today's `finish` body.
- Negative path: engine-owned sections (reduced build-review coverage, accepted risk) are still written and replaced as they are today, and a project cannot claim them.
<<< END INBOUND >>>
