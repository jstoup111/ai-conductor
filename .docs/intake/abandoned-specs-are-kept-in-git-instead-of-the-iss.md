# Intake origin: abandoned-specs-are-kept-in-git-instead-of-the-iss

Source-Ref: jstoup111/ai-conductor#1574
Owner: jstoup111

## Desired outcome

- Abandoning a spec leaves no plan artifact and no register row in the repository; the decision record is the closed issue.
- A reader looking for the abandonment procedure finds exactly one documented path, and it matches what the operator actually does.
- An operator or agent whose triage concludes that work should stop is told what the abandonment path is at the point of that conclusion.
- Backlog discovery still stops surfacing an abandoned slug, and a legitimately blocked-but-wanted plan is still distinguishable from an abandoned one.
- The 8 plans currently under `.docs/retired/` reach the same end state as any future abandonment, rather than being left as a grandfathered exception.
