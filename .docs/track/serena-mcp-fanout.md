# Track: serena-mcp-fanout

Track: technical

Internal harness infrastructure change to how the conductor spawns `claude` build
sessions and how Serena MCP is registered. No user-facing product behavior or
functional requirements — acceptance criteria live directly in stories. Bounds
Serena/MCP + language-server process fan-out across concurrent harness sessions
(intake jstoup111/ai-conductor#682).
