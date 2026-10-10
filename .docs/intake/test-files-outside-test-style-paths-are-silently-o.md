# Intake origin: test-files-outside-test-style-paths-are-silently-o

Source-Ref: jstoup111/ai-conductor#2807
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2807 digest=ab8d6c2cd32810b43ec46b2241fd4d86e725cc4f3c6aa501227f66f723cf7df0 >>>
## Desired outcome

- A changed file that declares a Covers marker is either reviewed by testQuality or reported as excluded, naming the file and why; it is never dropped silently.
- A file with no Covers marker outside test conventions still stays out of testQuality scope (negative path).
- The same path is classified the same way as a test or not by every gate that asks.
<<< END INBOUND >>>
