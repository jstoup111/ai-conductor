# Track: surface-evidence-path-overlap-as-suggested-depende

Track: product

Scope boundary: Balanced (operator-confirmed). At intake filing time, compare the new intake's cited evidence paths against open issues' cited paths in the target repo and against the diffs of unmerged in-flight branches (`spec/*` and daemon `feat/daemon-*`); surface overlaps as suggested dependencies before the issue is created, with accept (recorded link) or decline (recorded explicit no-dependency). A no-overlap filing behaves exactly as today. Consumer-facing and harness-wide: no dependence on this repository's layout or issue history. Excluded: fixing the `--depends-on` HTTP 422 link failure (#2714, treated as a blocker, not fixed here); extending DECIDE-time `overlap-scan` to `feat/daemon-*`; overlap detection for issues filed via the GitHub web/mobile issue form.

New filer-visible behavior (suggestions, accept/decline, non-interactive refusal until an explicit decision) is a user-facing capability with requirements worth a PRD.
