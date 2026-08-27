# Halt record

Status: halted
Slug: remove-retrospectives-full-and-micro-from-feature-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-remove-retrospectives-full-and-micro-from-feature-
Head SHA: bfdddca37eb0c5ef6105a2fad5f1b929644dd265
Halted at: 2026-08-27T17:26:48.448Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-bfdddca37eb0c5ef6105a2fad5f1b929644dd265: testQuality closed cause preflight-failed (materialization-failed: Error: ENOENT: no such file or directory, open '/home/james-stoup/code/ai-conductor/.worktrees/remove-retrospectives-full-and-micro-from-feature-/.pipeline/build-review-preflight/bfdddca37eb0c5ef6105a2fad5f1b929644dd265/skills/retro/SKILL.md'
    at async open (node:internal/fs/promises:1360:25)
    at async Object.writeFile (node:internal/fs/promises:2104:14)
    at async materializeTautologyPreflight (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:1705:7)
    at async DefaultStepRunner.runTautologyPreflight (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:19340:14)
    at async coordinateBuildReviewRubrics (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:17099:19)
    at async DefaultStepRunner.runRubricBuildReview (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:19034:26)
    at async DefaultStepRunner.runBuildReview (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:19538:7)
    at async Conductor.runSelfBuildDispatch (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:10263:14)
    at async Conductor.run (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/chunk-IO7NAN46.js:12324:151)
    at async Object.runConductorInWorktree (file:///home/james-stoup/code/ai-conductor/src/conductor/dist-versions/20260827T172153Z-9278310339a6/daemon-cli-KJD6Q6TX.js:3878:36)).
1. Record a reduced-coverage decision: conduct-ts build-review record-reduced-coverage --feature <feature-slug> --lap lap-bfdddca37eb0c5ef6105a2fad5f1b929644dd265 --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
