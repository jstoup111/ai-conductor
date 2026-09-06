# Intake origin: heal-pre-rebase-untracked-file-collisions-and-park

Source-Ref: jstoup111/ai-conductor#415
Owner: jstoup111

## Desired outcome
`resolveRebaseConflicts` (or a new pre-check in `performRebase`/`resumeRebaseFirst`) should
distinguish "genuinely mid-rebase, real conflict markers" from "git refused to even start the
rebase" and, for the latter, attempt a bounded self-heal appropriate to the specific git error —
e.g. for "untracked working tree files would be overwritten by checkout", stash or remove the
colliding untracked file(s) (safe when the file is unstaged/uncommitted build residue and the base
introduces the same path as a tracked file) and retry the rebase, before falling through to the
existing gated `/rebase` LLM resolver or, failing that, a human HALT with an accurate diagnosis in
the message (not the generic "resolve the conflicts" text).
