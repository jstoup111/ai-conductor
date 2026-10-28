**Status:** Accepted

# Stories: Composer hotfix PRs open under the bot identity

## Story 1: A hotfix PR opens as the configured bot

**Requirement:** Composer §3b hotfix publication

As an operator, I want composer hotfix PRs opened by the configured bot user, so that hotfixes carry the same authorship as `handoff` and daemon PRs.

### Acceptance Criteria

#### Happy Path
- Given the user config sets `github_bot.token_file` to a readable, non-empty file, when a composer hotfix is published, then `gh pr create` runs with `GH_TOKEN` set from that file and the PR author is the bot user.

#### Negative Paths
- Given the user config has no `github_bot.token_file`, or the file is missing or empty, when a composer hotfix is published, then the PR opens under the operator's account and the report states that the bot was not used.

### Done When
- [ ] `skills/composer/SKILL.md` §3b step 5 instructs bot-token PR creation with the operator-account fallback.
