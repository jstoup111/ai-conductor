# Complexity: Park in-flight features at step boundaries

Tier: M

The change adds one daemon lifecycle boundary across conductor step progression, persisted step status, daemon outcome classification, and resume behavior. It requires amendments to the existing product and architecture contracts plus focused cross-module tests, but adds no integration, authentication, model, or broad subsystem.
