# Track: self-host release gate — migration-gate waiver for non-breaking surface touches

Track: technical

Internal self-host gate semantics (TR-10 migration gate consumes a committed, machine-checkable
no-breaking-surface waiver instead of HALTing on filename-only matches). No product-facing
capability; acceptance criteria live in stories. Fix is contained to the self-host build path —
consumer-project pipelines are untouched. Source: jstoup111/ai-conductor#354.
