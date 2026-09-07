# Halt record

Status: halted
Slug: handle-runtime-values-as-literal-data-across-inter
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-handle-runtime-values-as-literal-data-across-inter
Head SHA: e75827181bb7ea8aa83cad76af6ac744df44c540
Halted at: 2026-09-07T04:45:55.664Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (existing-task: AB-1 is REMEDIABLE implementation drift against approved architecture, not an architecture change, so it routes to already-approved work rather than to plan growth or architecture_review (verified 100% by inert probe of the current source: checkInterpreterSource('p.sh','x=$(node -e "console.log($VALUE)")') returns [], while the same call at top level returns the expected 'shell expansion in interpreter command source' finding). Cause: wordAt swallows a whole $( ) region into one outer word at src/conductor/scripts/interpreter-source-check.ts:14-32, commandsOnLine returns only top-level words at :35-52, and checkInterpreterSource searches just those words for an interpreter token at :84-91, so an interpreter nested in a command substitution is never classified. Plan task 6 step 2 already requires tokenizing complete shell words and command boundaries INCLUDING nested command-substitution regions, and its Done-when 1 already requires rejecting command-substitution expansion in direct python -c and node -e/--eval source, so the remedy is admitted by an existing active-plan task and no new plan task is needed. Sibling site of the same class, found by probe and included rather than deferred: the heredoc-delimiter association at :54-57 and the pending-heredoc consumer at :72-83 read the SAME top-level word list, so an interpreter heredoc opened inside a substitution is equally invisible ('x=$(python3 <<EOS' with an expanding body returned [] on current source); that surface is admitted by plan task 7 step 2 and its Done-when 1, which is why both tasks are bound and the class is closed in one repair instead of leaving the next lap a successor finding. Deliberately excluded and recorded, not fixed: the shipped hook and installer call sites that the validator scans (hooks/claude/spec-coverage-check.sh, rate-limit-wait.sh, lint-after-edit.sh, block-destructive-git.sh, docs-guard.sh, diagram-coverage-check.sh, bin/install) are already-passing inventory members that no bound task admits editing, so they are not touched here. No coverage is removed or relaxed: the accept fixtures delivered by tasks 6 and 7 in src/conductor/test/scripts/interpreter-source-check.test.ts:16-31 (quoted heredoc, argv/stdin transport, escaped literal dollar, safe multiline single-quoted source) and the reject fixtures at :5-24 must all keep passing, the matched pair of nested-region tokenization and heredoc association is repaired together rather than one side only, and `bash test/check_interpreter_source.sh` must still exit 0 over the real repository after the regression for the nested command-substitution and nested-heredoc shapes is added.) — remediation produced no dispatchable build work; the implicated task(s) are already evidence-complete — human needed
```
