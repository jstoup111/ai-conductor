# Intake origin: as-built-invalid-verdict-halt-always-blames-plan-g

Source-Ref: jstoup111/ai-conductor#1911
Owner: jstoup111

## Desired outcome

- A halt raised because the verdict line could not be parsed says so, and quotes or names what it found where it expected the verdict.
- A halt raised because a PLAN_GAP report is missing `Outcome delivered: yes|no` still says exactly that, and is distinguishable by an operator from the case above without reading engine source.
- A halt raised because the verdict value is present but unrecognized names the value it read and the set it accepts.
- An operator reading only the halt marker can tell which of the three defects occurred.
