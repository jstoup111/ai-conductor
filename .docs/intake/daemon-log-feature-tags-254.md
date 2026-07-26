# Intake origin: daemon-log-feature-tags-254

Source-Ref: jstoup111/ai-conductor#254
Owner: jstoup111

## Desired outcome

- Every line emitted while a daemon feature is active begins with `[daemon][<feature truncated to 24 characters>]`.
- Repository-global daemon lines retain the existing `[daemon]` prefix without a feature tag.
