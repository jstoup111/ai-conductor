# Intake origin: prd-audit-halts-needs-human-when-as-built-case-his

Source-Ref: jstoup111/ai-conductor#3677
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3677 digest=a89f5b58b17deb6fb41d4b1f65e73bfe9f23309820dd7e708c6b3aa2d5d6595a >>>
## Desired outcome

- A feature with any number of open as-built cases reaches its next prd_audit or remediation lap without a projection size fault.
- The remediation agent can still see every prior as-built case, including its sources and repair tasks. Nothing is silently truncated.
- No needs-human halt is raised when no operator decision can resolve it.
- Features with small as-built histories behave exactly as today.
<<< END INBOUND >>>
