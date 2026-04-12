# Story: Pull Request Creation

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** pr/SKILL.md

As a developer, I want the pr skill to analyze the full diff, write a structured PR, and
create it via gh so that PRs are consistent, well-documented, and created without manual effort.

## Acceptance Criteria

### Happy Path
- Given the feature branch has commits ahead of the base branch, when the pr skill runs,
  then it analyzes the full diff (all commits, not just the latest) and drafts a title + body
- Given the PR body is drafted, when it is structured, then it includes: Summary (1-3 bullets),
  Test plan (checklist), and the generated-with-Claude-Code footer
- Given the PR is ready, when created via `gh pr create`, then the PR URL is returned
- Given the branch needs pushing, when the skill detects it, then it pushes with `-u` flag
  before creating the PR

### Negative Paths
- Given the branch has no commits ahead of the base, when the skill runs, then it reports
  "Nothing to create a PR for" and exits without creating an empty PR
- Given `gh` is not installed or not authenticated, when PR creation is attempted, then the
  error is reported with instructions to install/authenticate
- Given the PR title exceeds 70 characters, when drafted, then it is truncated or rewritten
  to fit

### Done When
- [ ] Full diff analyzed (all commits on the branch)
- [ ] PR title under 70 characters
- [ ] PR body includes Summary, Test plan, and Claude Code footer
- [ ] Branch pushed with -u if needed
- [ ] PR created via gh and URL returned
