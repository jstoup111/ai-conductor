# GREEN Phase — Detailed Guidance

## The Scope Check

Before writing ANY code, answer these three questions:

1. **Lines:** Will this change be ~20 lines or fewer? (excluding blank lines and comments)
2. **Files:** Will this touch 1 file only?
3. **Functions:** Will this modify 1 function/method only?

If ALL three are yes → proceed with implementation.
If ANY is no → this is too big for one GREEN phase. See `drill-down.md`.

## Writing Minimal Code

The goal is the **simplest code that makes the failing test pass**. Not the cleanest, not the
most extensible, not the "right" code. Just passing code.

Techniques:
- **Fake it:** Return a hardcoded value. Seriously. If the test expects `42`, return `42`.
  The next test will force you to generalize.
- **Obvious implementation:** If the implementation is trivially obvious (< 5 lines), just write it.
- **Triangulate:** If you faked it, write another test that forces a different value, then generalize.

## What NOT to Do in GREEN

- Don't refactor. That's after GREEN.
- Don't add error handling for cases not covered by a failing test.
- Don't "improve" nearby code you happen to notice.
- Don't add types, interfaces, or abstractions "for later."
- Don't optimize performance.

All of these are valid work — they just belong in a future RED phase, not this GREEN phase.

## Running Tests

After implementation:
1. Run the specific failing test → should pass now
2. Run the affected/scoped test union: the changed tests plus existing tests that cover the changed production modules
3. If that scoped union fails → the GREEN phase is blocked; fix the regression here rather than deferring it
4. If one of the repository's documented intermediate fallback triggers makes the affected set genuinely unsafe, name the exact trigger and run the configured aggregate verifier instead of a raw project-suite command

## Common GREEN Phase Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| Over-engineering | Building for future tests, not current one | Simplest passing code only |
| Touching multiple files | Scope too big for one GREEN | Use drill-down |
| Adding "while I'm here" fixes | Mixes concerns, harder to debug | Note it, do it later |
| Skipping affected tests | May hide a local regression | Run the affected/scoped union and block on failure |
