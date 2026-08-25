# Intake origin: coherence-rows-assert-story-task-coverage-that-not

Source-Ref: jstoup111/ai-conductor#1799
Owner: jstoup111

## Desired outcome

- A coherence row claiming a story criterion is covered by a named task is accepted only when the row grounds that claim in a verbatim quote that occurs in the cited task's committed text; a row whose quote the cited task's text does not contain is rejected at DECIDE, naming the criterion and the task it was attributed to. (Amended 2026-08-24: quote grounding is an evidence bound, not a semantic proof of support — per adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.)
- Every accepted story criterion is owned by at least one task before the plan is approved, and an unowned criterion is reported at DECIDE rather than at `acceptance_specs`.
- Every criterion row carries an authored diff-locality disposition when the plan is authored, and a row whose disposition is absent or names dependence on outside state — a count or census of a corpus that keeps growing — is rejected at DECIDE naming the criterion. (Amended 2026-08-24: the disposition is an authored forcing function, not engine analysis of the criterion's prose — per adr-2026-08-23-diff-locality-is-an-authored-disposition.)
- A plan whose criteria are all owned and all diff-local still passes with no added operator interaction beyond authoring the criterion rows themselves, and a legitimately deferred criterion can still be recorded as a deliberate disposition rather than silently dropped. (Amended 2026-08-24: the criterion rows are new authoring ceremony by design; the guarantee is no added rejection or operator round-trip for a clean plan.)
- When a later step does find an unowned criterion, its halt names the plan-time check that should have caught it.
