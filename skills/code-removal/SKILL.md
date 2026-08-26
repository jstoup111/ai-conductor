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

## Survivor Method

First identify the survivors: enumerate the behavior that must keep working after the removal.
Write this survivor inventory when the survivors are non-obvious, including a shared seam or
behavior partially carried by the code being removed. Skip the inventory only when every survivor
is obvious and fully covered by existing tests.

Follow this order:

1. Write the required survivor inventory.
2. Check each survivor for existing coverage.
3. For every uncovered survivor, add and commit a characterization test before any deletion.
4. Delete the obsolete code.
5. Run the full suite and leave it green.

Hard stop: do not proceed with deletion until each uncovered survivor has a characterization test.
