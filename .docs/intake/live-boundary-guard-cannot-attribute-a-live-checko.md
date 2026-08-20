# Intake origin: live-boundary-guard-cannot-attribute-a-live-checko

Source-Ref: jstoup111/ai-conductor#1301
Owner: jstoup111

## Desired outcome

- A live-checkout change made by an operator/interactive session is distinguished from one made by a self-host dispatch, rather than both presenting as an unattributable diff.
- A change positively attributable to something other than the running dispatch does not halt the build; the guard's detection of a genuine self-host leak is unchanged.
- Where attribution is impossible, the guard still halts — fail-closed is preserved.
- The halt reason names the attribution evidence, so an operator can tell a real leak from their own edit without reading source.
- `settings.local.json` and other config-like paths remain fingerprinted; this issue must not be resolved by widening the exclusion list.
- Regression coverage: a dispatch that writes the live checkout still halts; an operator edit during a dispatch does not.
