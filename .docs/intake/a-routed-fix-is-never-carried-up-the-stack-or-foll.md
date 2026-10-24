# Intake origin: a-routed-fix-is-never-carried-up-the-stack-or-foll

Source-Ref: jstoup111/ai-conductor#3212
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3212 digest=87d9441c2c141ef77203696b2a2421bbef71cd3fddb9c771f640a5409b6c41c5 >>>
## Desired outcome

- **Carried up.** A routed fix leaves its host through one journaled restack that moves the host's closure only after its region passes. The restack carries the fix into every child above.
- **Children above re-validate.** Every closed child a restack moved (for any cause) is re-validated, bottom-up and bounded. The leaf gates then re-run under their existing lap caps.
- **Return to the leaf.** The engine returns to the leaf only when no round is open and no child is waiting for re-validation.
- **Routing goes live.** With this spec shipped, routing is enabled for stacked features, and N=1 features remediate exactly as today.
<<< END INBOUND >>>
