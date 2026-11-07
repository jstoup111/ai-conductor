# Intake origin: routed-round-growth-halt-misreports-cap-overrun-as

Source-Ref: jstoup111/ai-conductor#3456
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3456 digest=f1f07a80a19fa366760c1b528696ac145b70bb3535a40331d40a9fbc45e20ea2 >>>
## Desired outcome

- A growth-exhaustion halt raised by a routed round states the pending routed charge, the cap, and the minimum raise that would admit the round, as the flat-repair halt already does.
- The halt names the findings or task ids the round would add. It does not report "repair record is malformed" when the record parses.
- "Malformed" appears only when a repair or route record actually fails to parse, and the halt then has the `needs-human` class rather than `kickback-cap`.
- The halt text and `ai-conductor kickback-budget inspect` report the same growth cap for the same feature at the same moment.
<<< END INBOUND >>>
