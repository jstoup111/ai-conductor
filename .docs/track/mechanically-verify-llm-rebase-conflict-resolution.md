# Track: Guard LLM rebase resolution integrity

Track: technical

This changes the internal rebase-resolution safety contract without adding user-facing product behavior. The selected direction preserves cross-file resolution capability, validates the full replay against source intent, and HALTs when correctness is ambiguous; mechanical file/hunk restrictions and whole-patch equality were rejected because legitimate semantic resolutions may require coordinated edits.
