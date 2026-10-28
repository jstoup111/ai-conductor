# Intake origin: routed-repair-opens-a-new-round-while-an-earlier-r

Source-Ref: jstoup111/ai-conductor#3445
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3445 digest=25c444d37ab6893503e6a5fa01ca793462f12b3883c53b1e7067d5865d744afc >>>
## Desired outcome

- A new routed round is never opened while another round for the same feature has a pending, admitted, repairing or built host.
- If a feature's durable routing state ever holds two open rounds, resume halts with a HALT naming both rounds, instead of failing silently.
- A round's unadmitted hosts are either run or explicitly settled before the feature returns to whole-feature audit.
<<< END INBOUND >>>
