# Complexity: Close already-fixed intake issues from compose forget

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one optional flag on an existing terminal CLI verb, its dispatch branch,
its help and guide text, and the composer skill instruction that decides when to pass the flag. It
reuses the existing source-ref parser, the existing injected `gh` runner, and the tracker client's
existing issue-comment and issue-close operations. It introduces no new verb, no new module, no new
ledger status, no schema change, no telemetry channel, and no third-party boundary. One production
engine file and one shipped skill file change; test changes extend two existing CLI test files.
Small-tier architecture, PRD, conflict-check, and coherence artifacts are not required.
