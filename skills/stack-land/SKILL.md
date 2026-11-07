---
name: stack-land
disable-model-invocation: true
description: "Use when an operator needs to land reviewed manual changes on the correct closed child of a stacked feature. Operator-invoked only: inspect ownership, propose the safe child with evidence, and require confirmation before opening the landing."
enforcement: advisory
phase: all
standalone: true
operator_only: true
requires: [verify-claims]
---

<!-- ai-conductor:session-command-context=operator-only -->

## Purpose

Guide an operator through opening a reviewer-edit landing on the child that owns
the affected code. This is an operator-only workflow: it never runs during a
dispatched step and never opens a landing without the person's explicit
confirmation.

## Procedure

1. Get the feature slug, the exact paths changed by the reviewer, and the
   reason for the landing. Do not infer ownership from a branch name, a title,
   or the current checkout.
2. Before proposing any child, run the ownership query for every affected path:

   ```bash
   ai-conductor stack owners --slug <slug> --path <path> [--path <path> ...]
   ```

   Preserve the output as the ownership evidence. It names each owning child
   with its position, branch, and slice title.
3. Propose the lowest-position child that owns the code being changed. State the
   proposed child number, its slice title, and the relevant `stack owners`
   evidence. If the change needs code that first exists in a higher child,
   propose that higher child instead and explain the prerequisite from the same
   evidence; do not silently carry a lower child upward.
4. Ask for explicit confirmation before changing anything. For example: “The
   proposed landing is child `<n>` — `<slice title>`; evidence: `<owners
   output>`. Shall I open this landing?” Do not run a command until the person
   confirms this proposed child and supplies or confirms the reason.
5. Only after confirmation, open the landing with the confirmed child:

   ```bash
   ai-conductor stack land --slug <slug> --child <n> --reason "<why>"
   ```

   Add `--carry <n>` only when the operator has explicitly confirmed the
   carried child and the command's ownership evidence establishes that it is
   required.
6. If the person rejects the proposal, do not run `stack land` for that child.
   Ask which child they want to use instead, show its title and the ownership
   evidence, and obtain a new explicit confirmation before any landing command.

## After the reviewer change

Once the operator has made and checked the reviewer change in the opened
landing, guide them to choose exactly one outcome:

- Declare it complete only when the landing is ready to resume daemon
  validation:

  ```bash
  ai-conductor stack land --slug <slug> --done
  ```

- Abandon it when the reviewer change will not be used:

  ```bash
  ai-conductor stack land --slug <slug> --abandon
  ```

## Refusals

If any `stack owners` or `stack land` command refuses, relay the refusal's
cause and its next command unchanged. Do not retry, alter arguments, choose a
different child, or work around the refusal. Wait for the operator to decide
what to do with the stated next command.

<!-- /ai-conductor:session-command-context -->
