# Track: Scoped BUILD/review commands cannot silently expand to the aggregate suite

Track: technical

Internal harness/engine machinery — repairs the test-invocation surface (arg-swallowing
npm script shapes, engine-side config validation, a scoped-run interface) so a scoped
BUILD or review command cannot expand into the aggregate suite. No user-facing product
behavior, so no PRD; acceptance criteria live directly in the stories.
