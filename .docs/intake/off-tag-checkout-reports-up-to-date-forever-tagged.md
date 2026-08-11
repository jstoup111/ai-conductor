# Intake origin: off-tag-checkout-reports-up-to-date-forever-tagged

Source-Ref: jstoup111/ai-conductor#1437
Owner: jstoup111

## Desired outcome

- An install whose checkout has advanced past its recorded release either identifies itself correctly or reports that it cannot — it never silently concludes it is current.
- Whatever the update check decides, a user can tell from its output which version identity it used and where that identity came from.
- An install sitting exactly on a release tag continues to resolve its identity from the checkout and to be offered newer tags exactly as it is today.
- An install with no determinable identity still declines to guess, as the current code deliberately does.
