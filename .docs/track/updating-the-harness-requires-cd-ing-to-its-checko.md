# Track: updating-the-harness-requires-cd-ing-to-its-checko

Track: technical

Scope boundary: minimal — one `update` subcommand on the installed CLI that resolves the harness checkout the CLI belongs to and runs that checkout's `bin/update` with the operator's arguments, inherited terminal, and its exit status; three pre-spawn refusals. Documentation of the command is delivered outside this spec, per the stories and plan documentation boundary. `bin/update`, the startup `--auto` check, the `bin/ai-conductor` shell wrapper, and the curl bootstrap (#1712) are not modified.

CLI plumbing over an existing script; no new product behavior beyond reachability. Source: jstoup111/ai-conductor#2605.

## Approaches weighed

- **Engine subcommand passing through to `bin/update` (chosen).** Listed in `--help` for free through `createProgram()`, testable with the injected-runner pattern `auto-update-check.ts` already uses, one code path.
- **Intercept `update` in the `bin/ai-conductor` shell wrapper before node starts.** Would still work with a broken `dist`, but cannot appear in `--help` without a second declaration, has no test seam beyond a shell fixture, and splits the CLI surface across two languages. Rejected for the minimal scope; a broken `dist` keeps today's `bin/update` path.
- **Teach `bin/update` to be installed on `PATH` itself.** Changes the installer and the script the bootstrap spec depends on unmodified. Rejected.
