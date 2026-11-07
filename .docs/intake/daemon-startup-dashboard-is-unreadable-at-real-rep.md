# Intake origin: daemon-startup-dashboard-is-unreadable-at-real-rep

Source-Ref: jstoup111/ai-conductor#1332
Owner: jstoup111

## Desired outcome

- On a daemon start in a repository with 55 parked and 30 retained features, an operator can tell within the first few lines of the dashboard whether anything needs their attention, and what.
- States that need no operator action do not consume more display space than states that do.
- Every row fits a phone-width terminal without wrapping, and no row's content is truncated in a way that makes two distinct features look identical or makes a slug uncopyable.
- Merged specs that cannot build are visible in the dashboard with their reason and remedy, in whatever grouping the redesign settles on.
- A feature in exactly one state still appears exactly once — the existing one-bucket invariant survives the redesign.
- The full detail currently rendered remains reachable on demand, not deleted.
