# Complexity: Daemon merged configuration (#967)

Tier: M

Rationale: The production change should remain localized to daemon startup, but the effective configuration controls provider selection, provider-native model and effort policy, build authentication, step overrides, and plugin settings across both bare and supervised daemon entry paths. Medium-tier architecture, conflict, coherence, and acceptance gates are warranted to protect precedence, invalid-config handling, and backward compatibility.
