# Follow-up Story: Normalize Built-In Provider Selection

**Status:** DRAFT
**Source:** Retro A-1 from #904

## Story

As an installer operator, I want built-in provider names accepted case-insensitively so the
installer's documented `Claude` and `Codex` examples work exactly as shown.

## Acceptance Criteria

- Given `--providers Codex`, when validation runs, then it selects the Codex provider successfully.
- Given mixed-case built-in provider names, when validation runs, then the normalized selection
  preserves the existing readiness and installation behavior.
- Given an unknown provider, when validation runs, then it still fails with the supported-provider diagnostic.
