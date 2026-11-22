# Complexity: Protect product code during SHIP validation

Tier: M

The approved behavior spans two boundaries. At dispatch, three validators need product-code protection when available, a visible warning and continued dispatch when unavailable, and writable evidence paths in both modes. At the parallel join, the engine must distinguish a stale verdict from a valid finding before routing repairs. Tests must prove both the write boundary and recovery after an independent code change. This warrants architecture review across dispatch and verdict handling. The scope is bounded to the existing SHIP validators and their existing repair lifecycle.

Delivery: Single implementation PR, operator-selected.
