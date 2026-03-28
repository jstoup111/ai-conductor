# Drill-Down — Nested TDD Cycles

## When to Drill Down

During the GREEN phase, if the scope check fails:
- Change would touch >20 lines
- Change would touch >1 file
- Change would touch >1 function

Then the implementation is too big for a single GREEN phase. Drill down.

## How It Works

Instead of implementing the full behavior in one GREEN phase, extract the smaller piece
and run a complete nested TDD cycle for it:

```
Outer cycle: RED (failing test for feature behavior)
  │
  ├── Scope check fails in GREEN
  │
  ├── Inner cycle: RED (failing test for smaller unit)
  │   ├── DOMAIN review
  │   ├── GREEN (implement small unit — passes scope check)
  │   ├── DOMAIN review
  │   └── COMMIT
  │
  ├── Resume outer GREEN (now the unit exists, implementation is smaller)
  │   └── Passes scope check → implement
  │
  ├── DOMAIN review
  └── COMMIT
```

## Example

**Outer RED:** "When a user submits an order, the total is calculated with tax"

**Outer GREEN scope check:** This needs a `TaxCalculator`, order total logic, and database
update — too big.

**Drill down:**

1. Inner RED: "TaxCalculator returns 8.25% of the subtotal for TX addresses"
2. Inner DOMAIN: Review — is `tax_rate: 0.0825` primitive obsession? (Decision: acceptable, single use)
3. Inner GREEN: Implement TaxCalculator (5 lines, 1 file, 1 function — passes scope check)
4. Inner DOMAIN: Review implementation
5. Inner COMMIT

6. Resume outer GREEN: Now TaxCalculator exists. The order total logic is ~10 lines, 1 file.
   Passes scope check → implement.
7. Outer DOMAIN: Review
8. Outer COMMIT

## Rules

- Drill-down can nest multiple levels (but if you're 3+ levels deep, the task is too big — split it in the plan)
- Each nested cycle is a full RED-DOMAIN-GREEN-DOMAIN-COMMIT
- Each nested cycle gets its own commit
- The outer test remains failing throughout the inner cycle(s)
