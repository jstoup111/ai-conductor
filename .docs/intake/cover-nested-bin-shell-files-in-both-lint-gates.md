# Intake origin: cover-nested-bin-shell-files-in-both-lint-gates

Source-Ref: jstoup111/ai-conductor#2161
Owner: jstoup111

## Desired outcome
- `bin/lib/*.sh` (and any future nested shell files under bin/) pass through both the `bash -n` and shellcheck gates.
- Any deliberately excluded path is listed explicitly rather than falling out of a non-recursive glob.
