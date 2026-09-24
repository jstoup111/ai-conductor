# Track: Authenticate contained Claude build_review reviewers

Track: technical

Scope boundary: All three #2737 desired outcomes — a contained Claude build_review reviewer authenticates with the credential of the resolved build-auth mode (the daemon build token in the default mode, which every daemon already holds; the ambient API key in api-key mode), with no extra setup for a daemon run; containment guarantees unchanged (exactly one credential value crosses the boundary through the env overlay, never a credential file, refresh token, or the operator's stored login); a missing or unreadable credential is refused before any review attempt is spent, naming the credential. Excluded: reading or refreshing the operator's stored Claude login, macOS keychain or cross-platform credential sourcing (#2735), and changes to non-contained steps or Codex reviewers.

Engine and containment defect fix with no new operator-facing capability; acceptance criteria live in stories.
