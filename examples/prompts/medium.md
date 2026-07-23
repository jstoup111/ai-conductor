# Medium: CSV export for the task list

Add a "Export to CSV" capability to the existing task list feature.

## Context

The app already has a task list (create/read/update/delete a task with a title, status,
and due date). Users want to get their tasks out of the app as a CSV file they can open in
a spreadsheet.

## Requirements

1. Add an `exportTasksToCsv(tasks: Task[]): string` function that serializes an array of
   tasks into CSV text: header row `title,status,due_date`, one row per task, values
   containing commas or quotes properly quoted per RFC 4180.
2. Wire a CLI/HTTP entry point (whichever the host app already exposes) that calls this
   function and writes/returns the CSV.
3. Handle the empty-list case (header row only, no crash).
4. Handle tasks with `undefined`/missing `due_date` (empty field, not `"undefined"`).

## Acceptance

- Unit tests cover: multiple tasks, empty list, a field containing a comma, a field
  containing a double quote.
- The new entry point is reachable from the existing app surface (route/command) without
  breaking any existing task-list behavior.

Sized for a single focused PR: one new function, one new integration point, a small test
suite — bigger than a one-function utility but still a single well-bounded feature.
