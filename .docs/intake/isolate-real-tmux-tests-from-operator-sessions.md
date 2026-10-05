# Intake origin: isolate-real-tmux-tests-from-operator-sessions

Source-Ref: jstoup111/ai-conductor#2476
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2476 digest=77b01b28924deec1be610a2f7788c879512a6d498c55a5ca0dd074e6d191c3d3 >>>
## Desired outcome

- Real-tmux tests cannot observe, replace, or terminate operator sessions, even if a production guard or test mock fails.
- Concurrent fixture runs cannot affect each other.
- Cleanup after success, failure, or interruption affects only fixture-owned resources.
- Newly introduced unsafe fixtures fail validation before they can affect operator sessions.
- Restart and cleanup behaviors retain meaningful coverage.
<<< END INBOUND >>>
