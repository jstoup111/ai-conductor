# Intake origin: daemon-log-feature-tags-254

Source-Ref: jstoup111/ai-conductor#254
Owner: jstoup111

## Desired outcome

- Every daemon line that belongs to a feature's execution or lifecycle begins with `[daemon][<feature truncated to 24 characters>]`.
- Unrelated process-wide diagnostics (for example, ambient `console.warn` or `console.error` output) remain repository-global unless they are explicitly emitted through the feature-owned logging boundary.
- Repository-global daemon lines retain the existing `[daemon]` prefix without a feature tag.
