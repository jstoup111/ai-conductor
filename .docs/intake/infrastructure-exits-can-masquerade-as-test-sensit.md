# Intake origin: infrastructure-exits-can-masquerade-as-test-sensit

Source-Ref: jstoup111/ai-conductor#2051
Owner: jstoup111

## Desired outcome

- A counterfactual command that fails before the intended tests execute because of bootstrap, authentication, or infrastructure contributes neither positive sensitivity evidence nor a feature failure.
- When external state cannot be faithfully counterfactually reverted, including database migrations or DDL, the counterfactual result does not by itself imply either test sensitivity or insensitivity.
- A genuine assertion or example failure caused by reverted production continues to provide useful sensitivity evidence across test frameworks.
- The existing testQuality judgement remains able to find a concrete stub-passable assertion independently of the counterfactual result.
