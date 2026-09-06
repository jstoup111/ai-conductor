# Intake origin: authenticate-otlp-export-with-env-referenced-heade

Source-Ref: jstoup111/ai-conductor#1939
Owner: jstoup111

## Desired outcome
- Telemetry can be delivered to an authenticated OTLP endpoint using configuration alone, with no
  intermediary collector required to attach credentials.
- **A credential is never stored as plaintext in harness configuration.** Config carries a
  *reference* to a secret, not the secret; the literal value is resolved at load from a source
  outside the config file.
- More than one secret source is supported, so an operator is not forced into a single storage
  choice — at minimum an environment-variable reference and one at-rest option that is not a
  world-readable file (OS keychain, secret manager, or a file whose permissions are enforced).
- A literal secret written directly into a config file is detected and refused, or at minimum
  reported as a warning naming the key, rather than silently accepted — the insecure path must
  not be the quiet default.
- Rotating a credential does not require editing project configuration or a repository commit.
- The resolved credential is held only as long as an export needs it and is not written to any
  harness-owned artifact — not `events.jsonl`, `.pipeline/`, the audit trail, a HALT file, or a
  crash dump.
- A rejected or unauthorized export surfaces as a named, actionable warning that identifies
  authentication as the cause, rather than as silence or a generic export failure — and the
  warning names the credential *source*, never the value.
- A malformed authentication configuration is reported by name at config load, consistent with
  how `otel-config.ts` already names an unknown exporter or a missing endpoint.
- Whatever mechanism carries credentials is documented in `docs/reference/configuration.md`
  alongside the other `otel` keys, so it is not an undocumented side channel.
- Credential values do not appear in logs, events, error text, or exported telemetry, including
  when the failing export is retried or the config is echoed back for diagnosis.
