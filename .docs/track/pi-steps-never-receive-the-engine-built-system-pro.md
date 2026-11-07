# Track: Pi steps never receive the engine-built system prompt

Track: technical

Scope boundary: deliver `InvokeOptions.systemPrompt` to Pi (file-backed, safe above 128 KiB), add a
declared system-prompt delivery capability enforced at the shared dispatch seam for built-in and
plugin providers (undeclared plugins fail closed with a named reason), and a cross-provider contract
test. Claude and Codex delivery is unchanged. Excludes a per-call-site audit of every engine system
prompt builder.

Internal provider plumbing with no new user-facing capability; the only operator-visible change is
a named dispatch failure. Source: intake jstoup111/ai-conductor#3309.
