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
2. Run the full test suite → nothing else should have broken
3. If something broke → your change has unintended side effects. Revert and think smaller.

## Common GREEN Phase Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| Over-engineering | Building for future tests, not current one | Simplest passing code only |
| Touching multiple files | Scope too big for one GREEN | Use drill-down |
| Adding "while I'm here" fixes | Mixes concerns, harder to debug | Note it, do it later |
| Skipping full suite run | May have broken something | Always run full suite |
