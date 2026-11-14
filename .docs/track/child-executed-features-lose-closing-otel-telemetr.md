# Track: Child-executed features lose closing OTel telemetry at shutdown

Track: technical

Scope boundary: hotfix-sized. Covers the four desired outcomes of #3645: closing spans and metrics at SIGTERM, a span export and metric flush when each child dispatch ends, a SIGHUP that still waits for an ending dispatch, and bounded shutdown. Excludes `stopAll`'s fixed full-allowance wait, the child `'exit'`-versus-final-IPC-message race, and any change to the in-process executor that #3333 removes.

Internal daemon telemetry defect with no product requirements. The chosen approach splits the broker's abort, which rejects pending coordination calls, from detach, which stops event forwarding.
