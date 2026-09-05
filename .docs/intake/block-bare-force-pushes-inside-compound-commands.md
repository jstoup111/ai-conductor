# Intake origin: block-bare-force-pushes-inside-compound-commands

Source-Ref: jstoup111/ai-conductor#2159
Owner: jstoup111

## Desired outcome

- A bare `--force` push is blocked even when `--force-with-lease` appears elsewhere on the same command line.
- A legitimate single `--force-with-lease` push still passes.
