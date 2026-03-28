# RED Phase — Detailed Guidance

## Choosing What to Test Next

Priority order:
1. Next acceptance criterion from the implementation plan
2. If no plan: the simplest untested behavior that moves toward the feature
3. If fixing a bug: the reproduction case

## Writing the Test

1. **Describe the behavior, not the implementation**
   - Good: `it "rejects expired authentication tokens with 401"`
   - Bad: `it "calls TokenValidator.validate and checks expiry field"`

2. **One assertion per test**
   - Test one behavior. If you need multiple assertions, you're testing multiple behaviors.
   - Exception: asserting both the status code AND the response body of an error response is fine — they describe one behavior from different angles.

3. **Use concrete examples, not abstract descriptions**
   - Good: `given: user with role "viewer", when: accessing /admin, then: 403`
   - Bad: `given: unauthorized user, when: accessing restricted resource, then: error`

4. **Set up only what's necessary**
   - Don't create records/objects the test doesn't use
   - Use factories/builders, not fixtures (when tech-context supports it)

## Watching It Fail

Run the test BEFORE writing any implementation. Read the failure message carefully:

- **Expected failure:** Test fails because the behavior doesn't exist yet. Proceed to DOMAIN.
- **Wrong failure:** Test fails due to syntax error, missing import, or unrelated issue. Fix the test setup, not the production code.
- **No failure:** Test passes immediately. The behavior already exists — investigate before proceeding.

## Common RED Phase Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| Writing multiple tests at once | Can't isolate which behavior you're building | One test per cycle |
| Test passes immediately | You're not testing new behavior | Investigate existing code |
| Testing implementation details | Tests become brittle on refactor | Test behavior and outcomes |
| Vague test names | Can't tell what broke when test fails | Name the specific behavior |
| Over-specifying mocks | Couples test to implementation | Mock at boundaries only |
