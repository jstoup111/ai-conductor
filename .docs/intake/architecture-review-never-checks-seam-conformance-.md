# Intake origin: architecture-review-never-checks-seam-conformance-

Source-Ref: jstoup111/ai-conductor#1995
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1995 digest=b0ab0ef406d70700e551becf53dc592113b172683b7579e2c35dba3a44596ff8 >>>
## Desired outcome

- When a reviewed change introduces an external-system call that bypasses the project's own approved boundary interfaces (as defined by that project's ADRs), architecture review surfaces it as a blocking finding; introducing a new boundary properly (with its ADR) still passes.
- **The check is project-agnostic**: the skill text names no repository-specific boundaries, ports, or file paths — it derives the seam inventory from the consuming project's own approved ADRs/architecture artifacts, and it degrades gracefully (no false blocks) in a project that has not defined any seams.
- Mechanical import-direction violations remain the linter's job (#1988); this check covers only what requires judgement (is this call an external boundary, and does an approved seam govern it?).
<<< END INBOUND >>>
