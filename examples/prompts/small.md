# Small: `slugify` utility function

Add a single utility function `slugify(input: string): string` that converts a string into
a URL-safe slug: lowercase, trim, spaces/underscores replaced with hyphens, and any
character that isn't `[a-z0-9-]` stripped. Collapse repeated hyphens into one and trim
leading/trailing hyphens.

## Acceptance

- `slugify("Hello World!")` → `"hello-world"`
- `slugify("  Multiple   Spaces  ")` → `"multiple-spaces"`
- `slugify("")` → `""`
- Function is unit-tested with at least these three cases.

This is intentionally scoped to one function, one file, no new dependencies — sized for a
quick inline or engineer/idea run.
