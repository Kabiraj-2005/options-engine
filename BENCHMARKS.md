# Benchmarks

Reference inputs unless noted: S=1400, K=1500, T=0.25, r=0.06, v=0.30
Exact (Black-Scholes) price: **52.6884**

Official speed numbers come from the primary benchmark machine only
(HP Pavilion, Linux, 2 cores, 4 threads (i3-6100U), `g++ -O2`). Numbers
from other machines are sanity checks and are kept in a separate table.

## Accuracy (single runs)

| Paths | Monte Carlo price | Absolute error | Standard error | 95% band |
|---|---|---|---|---|
| 1,000,000 | 52.8503 | 0.1619 | ~0.108 | ±0.21 |
| 10,000,000 | 52.6928 | 0.0044 | ~0.034 | ±0.067 |

Standard error = (discounted payoff standard deviation) / √n. The payoff
standard deviation for this contract is about 108.

Both results fall inside their 95% bands, so they are consistent with a
correct simulation. These are single runs, so they say nothing precise
about the convergence rate. Monte Carlo error is expected to shrink as
1/√n, i.e. about 3.2x for each 10x increase in paths.

**To do:** run each path count with 10+ seeds and report the mean
absolute error and standard error (see `ISSUES.md` #1).

## Speed — primary machine (HP Pavilion, Linux, 2 cores, 4 threads (i3-6100U))

| Version | Paths | Time (median) | Speedup |
|---|---|---|---|
| Naive, single-threaded, `-O2` | 10,000,000 | 810.05 ms | 1.00x |

## Speed — cross-machine sanity check (not comparable to the table above)

| Version | Paths | Machine | Time | Per path |
|---|---|---|---|---|
| Naive, single-threaded | 1,000,000,000 | MacBook Air M3 | ~92,000 ms | ~92 ns |

**Needs recheck:** the ~92 ns/path Mac figure may have come from a build
without `-O2` (the VS Code run button does not pass it), so it should not
be used to claim per-path cost is the same on both machines.

## Pending

### Thread scaling (10,000,000 paths, Pavilion)

Protocol: run `scripts/benchmark.sh` (7 runs per thread count, median
reported, time includes thread creation; results saved to
`results/benchmark-<commit>.txt`). The baseline is `./pricer 1`. A price outside
52.6884 ± 0.07 means a bug regardless of speed.

| Threads | Median time | Speedup vs. 1 thread | Price |
|---|---|---|---|
| 1 | to be measured | to be measured | to be measured |
| 2 | to be measured | to be measured | to be measured |
| 4 | to be measured | to be measured | to be measured |
| 8 | to be measured | to be measured | to be measured |

Thread `t` uses seed `42 + t`, so prices differ slightly between thread
counts. With 1 thread the price must equal the single-threaded price
exactly; anything else means a bug.

### Later stages

| Version | Paths | Time | Speedup vs. baseline |
|---|---|---|---|
| Faster RNG (Box-Muller + xorshift/PCG) | 10,000,000 | | |
| + SIMD | 10,000,000 | | |
| + Variance reduction | *fewer paths, same accuracy* | | |
