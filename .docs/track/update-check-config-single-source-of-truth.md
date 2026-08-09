# Track: update-check config single source of truth

Track: technical

Internal config plumbing and schema correctness — the update-check state surface is repointed
from the legacy `~/.claude/ai-conductor.config.json` to the documented, typed, schema-validated
`conductor:` block in `~/.ai-conductor/config.yml`. No user-facing capability and no product
requirements; acceptance criteria live directly in the stories.
