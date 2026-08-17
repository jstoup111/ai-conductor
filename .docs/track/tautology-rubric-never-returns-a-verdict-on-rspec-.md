# Track: Framework-agnostic tautology scoped-run classification

Track: technical

The change replaces a framework-specific output classifier inside an existing BUILD gate with an
exit-code contract, and retains runner output for infrastructure failures on the existing event
spine. It adds no user-facing product capability and no new configuration surface, so there are no
product requirements to specify; acceptance criteria live in the stories.
