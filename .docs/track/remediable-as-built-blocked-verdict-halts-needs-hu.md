# Track: remediable-as-built-blocked-verdict-halts-needs-hu

Track: technical

Scope boundary: diagnostic-only. Close the remaining silent fallthrough — `planRemediation`'s terminal `none` exit carries a reason, the as-built gate reason distinguishes REMEDIABLE from DESIGN, and the validation-group halt appends per-finding detail for both kinds. No routing change; the bounded remediation route (adr-2026-08-25) stays as-is. Excludes a shared reason renderer and the serial as-built halt site, which already names findings.

Engine halt-diagnostic change with no new product capability; acceptance criteria live in stories.
