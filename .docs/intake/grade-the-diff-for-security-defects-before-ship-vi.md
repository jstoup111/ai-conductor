# Intake origin: grade-the-diff-for-security-defects-before-ship-vi

Source-Ref: jstoup111/ai-conductor#2034
Owner: jstoup111

## Desired outcome

- A build whose diff introduces a security defect (e.g. committed credential, injection path, missing authz check) fails build_review with a finding naming the defect and location, before the SHIP tail runs.
- A clean diff passes without security-related kickback noise (false-positive rate low enough that operators do not routinely override).
- Security findings flow through the adjudicator (#2033) like any other rubric's.
