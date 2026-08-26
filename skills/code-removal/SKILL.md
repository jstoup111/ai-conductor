---
name: code-removal
description: "Use when removing a file, seam, flag, symbol, or code path. Defines the evidence and test discipline for deletion-shaped work."
enforcement: advisory
phase: all
---

## Purpose

Removal is a first-class change type. Its deliverable is the deletion itself and an intact
surviving suite, not a new test asserting that the removed thing is absent. Treat removal-shaped
work as a change to what remains: remove the obsolete file, seam, flag, symbol, or code path, and
preserve the behavior that survives it.

The evidence for a completed removal is the deletion diff plus the full surviving suite green.
Deletion does not create new behavior to prove, so do not manufacture an absence assertion to
make removal work look like an additive test cycle.

## Absence-Test Prohibition

At spec time, do not write a plan task or story criterion whose subject is that code, files, or
symbols no longer exist. Plans and stories describe the deletion and the observable behavior that
must survive it; they never prescribe an absence test or label one verify-only to force its
creation.

At build time, do not author a test whose subject is that removed code no longer exists. The
removal-anchored tautology exemption ADR,
`adr-2026-08-12-removal-anchored-tautology-exemption.md`, governs review treatment for test
maintenance directly anchored to removal evidence; it does not make an absence assertion useful
evidence. Use the deletion diff and a green full surviving suite as the evidence instead.
