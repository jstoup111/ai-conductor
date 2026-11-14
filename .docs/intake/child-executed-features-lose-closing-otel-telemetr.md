# Intake origin: child-executed-features-lose-closing-otel-telemetr

Source-Ref: jstoup111/ai-conductor#3645
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3645 digest=e68686be473806f465ad7b421e4a55e8d10dca530fc4dfb5229ca3a56ddcfcef >>>
## Desired outcome

- When the daemon receives SIGTERM with child-executed features in flight, the events each child emits while closing its open executions appear as spans in the collector and are counted by the daemon's metrics, as they are under the in-process executor.
- When a child dispatch ends, its spans are exported (or durably spooled) and its metrics flushed before the dispatch counts as finished.
- A SIGHUP arriving while a child dispatch is ending still waits for that dispatch's spans to finish exporting.
- Shutdown stays bounded: a child that ignores `stop` is still killed after the teardown allowance, and the daemon still exits.
<<< END INBOUND >>>
