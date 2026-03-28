# Tech-Context Format

## Purpose

Tech-context directories provide stack-specific knowledge that augments the harness's
technology-agnostic skills. Each directory targets a specific stack combination and provides
one file per skill that benefits from stack awareness.

## Contract

Each tech-context directory MUST provide these files:

| File | Used By | Contains |
|------|---------|----------|
| `tdd.md` | `tdd` skill | Test framework, conventions, commands, factory patterns |
| `stories.md` | `stories` skill | Stack-specific negative path categories |
| `debugging.md` | `debugging` skill | Stack tools, log locations, common gotchas |
| `review.md` | `code-review` skill | Security checklist, performance antipatterns |

## Rules

1. **Additive only** — Tech-context adds stack-specific checks. It never overrides or removes
   generic skill behavior.

2. **Self-contained** — Each file must be readable without the others. Skills load one file
   at a time, not the whole directory.

3. **Concrete** — Include specific commands, gem/package names, and config patterns. Not
   abstract guidance.

4. **Maintained** — If a stack-specific issue recurs in retros, add it to the relevant file.

## Directory Naming

Use `<framework>-<database>` format: `rails-postgres`, `nextjs-postgres`, `fastapi-postgres`.

## Detection

The `bootstrap` skill detects the stack from project files:
- `Gemfile` with `rails` + `pg` → `rails-postgres`
- `package.json` with `next` + `prisma` → `nextjs-postgres`

If no match, skills proceed without tech-context — they never fail because of missing context.
