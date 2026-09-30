# Track: Durable OTel export queue

Track: technical

Scope boundary: Balanced. Engine-side write-first disk spool in the daemon for spans and metrics, covering backend down, local collector down, daemon restart/crash, and network partition; backend-agnostic OTLP delivery verified against Datadog (Agent/DDOT) and Grafana LGTM, with documented collector config for both. Excluded: logs/daemon.log export (#1935), replay/backfill from events.jsonl, client-side per-backend age caps.

Export reliability of the existing OTel projection; no new user-facing behavior.
