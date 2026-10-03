# Intake origin: vitest-daemon-fixtures-leak-into-shared-operationa

Source-Ref: jstoup111/ai-conductor#2471
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2471 digest=71f45dd3edb24a92c71e13b76bb94836f043f886df445bbf1452b799fbad4710 >>>
## Desired outcome

- Ordinary unit, integration, acceptance and end-to-end tests produce no telemetry in a shared operational backend, including when the invoking operator has OTel export enabled.
- Tests can still exercise daemon telemetry behavior through controlled local or fake boundaries; ordinary verification does not require a shared collector or its credentials.
- Real daemon telemetry continues to export with the configured project and worker identities.
- Any test intentionally exporting to an external/shared backend is explicitly opt-in smoke coverage and excluded from default verification.
- A new ordinary test run creates no additional fixture-project series in the shared backend, without relying on Grafana exclusions.
<<< END INBOUND >>>
