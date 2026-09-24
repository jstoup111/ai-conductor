# Track: Custom build_review rubrics run on every platform without an OS containment boundary

Track: technical

Scope boundary: All four #2735 desired outcomes (as amended 2026-09-24): a custom rubric produces a verdict on macOS, on Linux under Ubuntu's default AppArmor userns restriction, and on Linux with unrestricted bwrap; the reviewer cannot change the frozen source, baseline, installed policy, or engine evidence — writes are blocked by the provider's read-only review mode (Claude read-only tool set, Codex `sandbox_mode="read-only"`) and any change that still occurs is detected by an engine digest check and the verdict discarded; a platform where a provider's read-only review mode is unavailable is reported up front (config load / status) with the platform named, before any review fault is spent; built-in rubrics and non-review steps behave as today. Chosen approach: detect-and-discard — custom-policy laps run in the same provider environment as built-in laps (no bubblewrap boundary, no scratch HOME/CLAUDE_CONFIG_DIR, no env allowlist), replacing adr-2026-09-10-portable-build-review-policy D5's OS containment requirement. Excluded: an OS-proven read boundary on any platform (per-platform bwrap/Seatbelt backends and @anthropic-ai/sandbox-runtime were considered and rejected), changes to built-in-only laps, and ordinary BUILD sandboxing. Supersedes #2737 (closed).

Engine defect fix to an existing opt-in capability; the only operator-facing addition is the up-front unsupported report, so acceptance criteria live in stories.
Source-Ref: jstoup111/ai-conductor#2735
