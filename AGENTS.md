# AI Conductor — Codex Instructions

## Repository-local test design

Before adding, changing, reviewing, or debugging tests in this repository, read and follow
[`.agents/skills/write-tests/SKILL.md`](.agents/skills/write-tests/SKILL.md). It defines the
repository-specific rules for test scope, dependency-injected fakes, bounded Conductor fixtures,
cleanup, and CI runtime.

Use the provider-neutral `tdd` skill for implementation order. The repository-local write-tests
skill governs how the tests themselves are designed.
