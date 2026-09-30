# Intake origin: plans-cannot-declare-ordered-slices-of-one-feature

Source-Ref: jstoup111/ai-conductor#2723
Owner: jstoup111

## Desired outcome

- A project can opt into stacked publication with a single config option. It is off unless explicitly enabled, and an invalid value is rejected at config load with the offending key named.
- With the option off, a plan that declares slices behaves exactly as it does today: one branch, one PR, no slice-dependent behavior.
- A plan can declare a small number of ordered slices, each naming the plan tasks it contains and a short reader-facing title.
- A plan whose slice declarations are malformed is refused before it lands, with the problem named. Malformed means:
- a task in no slice, or in two slices;
- a slice with no tasks;
- duplicate slice order positions;
- a slice referencing a task id that does not exist;
- a task depending on a task in a *later* slice.
- The number of slices a plan may declare is bounded, and exceeding the bound is refused at land with the bound named.
- A plan that declares no slices remains valid whether the option is on or off, and publishes as a single PR.
- Slice declarations survive DECIDE amendments and reseals the same way task declarations do (see #1700): an amendment that moves a task between slices is visible and re-validated, never silently dropped.
