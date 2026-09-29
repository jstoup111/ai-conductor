# Track: Link intake depends-on with a typed issue id

Track: technical

Scope boundary: Small fix for #2714, approved by the operator on 2026-09-28 (delegated). The registered dependency-add operation sends the blocking issue's database id as a typed integer field, never an issue-number fallback; the tracker client's dependency add resolves that id first like every other caller; and the intake filer prints a distinct final line for each `--depends-on` link it could not record. Keeping filing exit 0 after a successful create is preserved (the issue's desired outcome asks for unmistakable output, and a non-zero exit would invite a duplicate re-filing). Relinking already-filed issues, the bundled-helper move (#742), overlap-suggested dependencies (#1606), and Jira dependency links are outside this slice.

This is internal engine and CLI-output correction; acceptance criteria live in technical stories rather than a PRD.

Scope check: A — consumer-facing (the intake filer and the registered GitHub dependency operation run in every repository that files intake through the harness; no repo-only signal fires); B — n/a (no new skill); C — provider-agnostic (GitHub transport only, no LLM provider involved). No catalog registration, CLI flag, settings, hook, or symlink change.

Verified foundation: `ghArgsFor` in `src/conductor/src/engine/tracker-client.ts` builds the `issue.dependency.add` / `intake.issue.dependency.add` argv with `-f`, which sends `issue_id` as a string (the reported HTTP 422), and falls back to `issue_number=<n>` when no database id is supplied; `issue-dep-migration.ts` documents that the endpoint only accepts `issue_id`. `createIntakeFilingOperations` in `file-issue.ts` and `createDependencyLinks` in `issue-dep-migration.ts` (used by `label-sync.ts`) both resolve the database id before posting, while the tracker client's `addIssueDependency` passes none and so always takes the fallback. `fileIntakeIssue` records a dependency failure only as a warning string, and `src/conductor/src/intake-file-cli.ts` prints warnings as `[intake-file] warning:` lines among its other output.
