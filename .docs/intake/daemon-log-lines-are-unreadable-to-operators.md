# Intake origin: daemon-log-lines-are-unreadable-to-operators

Source-Ref: jstoup111/ai-conductor#2867
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2867 digest=dbd6cef6d61a2bde5bdbb4f4e12aff871ab7b6b5a445fb1eaaa471b07af4fa5a >>>
## Desired outcome

- A gate verdict that adjudication can still overturn is labelled provisional in the log (e.g. "provisional FAIL, pending adjudication"), and a single final-verdict line follows adjudication.
- Findings are shown by human-readable title, not only sha256 id; no bare UUIDs appear in the default operator log view.
- A halted feature's retention is logged once per state change, not every tick.
- Per-step boilerplate (session-reuse notices, containment-unavailable, fingerprint timings, provider lifecycle triples) appears at most once per run or only at a verbose level.
- Raw JSON, raw git stderr and multi-line prompt/agent text do not appear inline in the default log; where retained, they are summarized to one line.
- Every warning/halt line in the log states the next operator action, or says none is needed.
<<< END INBOUND >>>
