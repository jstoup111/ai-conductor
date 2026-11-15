# Intake origin: no-op-guard-refuses-a-kickback-with-new-review-cas

Source-Ref: jstoup111/ai-conductor#3661
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3661 digest=29eef7ba2526e63bc8b47e7ccef68b701ffd4e13a391728ea8483c8a4e12a169 >>>
## Desired outcome

- A kickback carrying cases or a work order the previous no-op build never saw is dispatched to BUILD, not refused.
- A repeated kickback with the *same* work after a no-op build is still refused (the guard keeps its purpose).
- When the guard does refuse, clearing HALT is enough to retry, or the HALT names a supported command that is.
- Negative path: a zero-work revalidation BUILD followed by a clean review still moves on without a halt.
<<< END INBOUND >>>
