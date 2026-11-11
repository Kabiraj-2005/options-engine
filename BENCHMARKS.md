# Benchmarks

Reference inputs unless noted: S=1400, K=1500, T=0.25, r=0.06, v=0.30
Exact (Black-Scholes) price: **52.6884**

Official speed numbers come from the primary benchmark machine only:
HP Pavilion, Linux, Intel i3-6100U, **2 physical cores, 2 threads per core
(4 logical CPUs)**. Numbers from other machines are development checks and
are kept in a separate, clearly labelled section.

## Thread scaling (official)

Machine: HP Pavilion (i3-6100U, 2 cores / 4 threads), Linux.
Build: `g++ -std=c++17 -O2 -pthread`. Commit `77419a1`, 4 Nov 2026.
10,000,000 paths, 7 runs per thread count, median reported, time includes
thread creation. Produced by `scripts/benchmark.sh`. Thread `t` uses seed
`42 + t`.

| Threads | Median time | Speedup vs. 1 thread | Price | Absolute error |
|---|---|---|---|---|
| 1 | 681.787 ms | 1.00x | 52.6928 | 0.0044 |
| 2 | 342.396 ms | 1.99x | 52.6814 | 0.0070 |
| 4 | 234.451 ms | 2.91x | 52.6983 | 0.0099 |
| 8 | 245.393 ms | 2.78x | 52.6646 | 0.0238 |

What this shows:

- **2 threads scale almost perfectly** (1.99x) on the 2 physical cores.
- **4 threads add about 46%** over 2 threads (342.396 → 234.451 ms), using
  hyperthreading (2 threads per core). Why hyperthreading helps this much
  has not been measured yet.
- **8 threads give no gain** over 4: the machine has only 4 logical CPUs.
- Every price is within 52.6884 ± 0.07.

Speedups in this table are relative to the 1-thread median above, not to
the historical 810.05 ms figure below.

**Measured before the standard error was added** (8 Nov 2026). The hot
loop now also adds up each payoff squared. Its effect on these times has
not been measured on the Pavilion yet; rerun `scripts/benchmark.sh` there.

### Historical single-threaded baseline

| Version | Paths | Time | Date |
|---|---|---|---|
| Naive single-threaded, `-O2` (commit `b6f226c`) | 10,000,000 | 810.05 ms | 26 Aug 2026 |

This was one measurement with the original single-threaded code. The
1-thread time on 4 Nov 2026 is 681.787 ms. **The reason for the drop is
unknown** (it was not measured under the same conditions), so the two
figures should not be compared or divided.

## Accuracy

### Multi-seed convergence (closes the measurement part of ISSUES #1)

`scripts/convergence.sh`, 50 base seeds per path count (1000, 1004, ...,
4 threads, so no two runs share a thread seed), run 4 Nov 2026 on the
MacBook (`-O2`).

| Paths | Seeds | Mean price | Mean absolute error | RMSE |
|---|---|---|---|---|
| 1,000,000 | 50 | 52.7223 | 0.0869 | 0.1084 |
| 10,000,000 | 50 | 52.6923 | 0.0302 | 0.0379 |

- Theory (payoff standard deviation ~108): RMSE ~0.108 at 1M and ~0.034 at
  10M. Measured: **0.1084 and 0.0379**.
- RMSE fell by **2.86x** for 10x more paths; 1/√n predicts 3.16x. With 50
  seeds the RMSE itself is only known to about ±10%, so this is consistent
  with 1/√n but not a precise confirmation.
- The 1M mean (52.7223) is 0.034 above exact, about 2.2 standard errors.
  A recheck with 400 different seeds at 1M paths gave mean 52.6817 (bias
  -0.0067, 1.2 standard errors) and RMSE 0.1086, so the first bias looks
  like chance, not a systematic error.
- Accuracy does not depend on speed, so the Mac is fine for this. The
  Linux machine gave exactly the same prices as the Mac for the default
  seeds (table above), so the random numbers match across both machines
  for those cases.

### Standard error reported by the engine (8 Nov 2026)

Since 8 Nov 2026 the engine returns the standard error with each price
(ISSUES #1). Default seed 42, run on the MacBook (`-O2`); accuracy does not
depend on the machine.

| Paths | Threads | Price | Standard error | 95% interval | Contains 52.6884? |
|---|---|---|---|---|---|
| 1,000,000 | 1 | 52.8503 | 0.1087 | 52.6373 to 53.0634 | yes |
| 1,000,000 | 4 | 52.5970 | 0.1081 | 52.3851 to 52.8089 | yes |
| 10,000,000 | 1 | 52.6928 | 0.0343 | 52.6256 to 52.7599 | yes |
| 10,000,000 | 4 | 52.6983 | 0.0343 | 52.6311 to 52.7654 | yes |

- The single-run standard error (0.108 at 1M, 0.034 at 10M) matches the
  multi-seed RMSE above (0.1084, 0.0379), so one run now gives an honest
  error estimate.
- It does not depend on the thread count, because the threads' sums and
  sums of squares are added first and the error is computed once from the
  totals.
- Default prices are unchanged by this change (52.6928 / 52.6814 /
  52.6983 / 52.6646 for 1/2/4/8 threads).

### Other contracts and puts (11 Nov 2026)

Checks that Monte Carlo matches Black-Scholes away from the reference
contract. MacBook, `-O2`, 4 threads, seed 42, 10,000,000 paths unless
noted.

| Contract | Type | Black-Scholes | Monte Carlo | Inside 95% interval? |
|---|---|---|---|---|
| Reference (S=1400, K=1500, T=0.25, r=0.06, v=0.30) | put | 130.3564 | 130.3270 ± 0.0437 | yes |
| S=100, K=105, T=1, r=0.05, v=0.2 | call | 8.0214 | 8.0228 ± 0.0042 | yes |
| S=100, K=105, T=1, r=0.05, v=0.2 | put | 7.9004 | 7.8981 ± 0.0033 | yes |
| Reference with r=-0.01, T=2, v=0.5 | put | 473.0793 | 472.9838 ± 0.1368 | yes |
| Reference with S=2000 (1M paths) | put | 2.0821 | 2.0701 ± 0.0169 | yes |

The put prices also agree with put-call parity
(put = call − S + K·e^(−rT)).

### Early single runs (historical, 26 Aug 2026)

| Paths | Monte Carlo price | Absolute error |
|---|---|---|
| 1,000,000 | 52.8503 | 0.1619 |
| 10,000,000 | 52.6928 | 0.0044 |

Single runs only; they say nothing precise about the convergence rate.
Use the multi-seed table above instead.

## Development machine (MacBook Air M3): not official

These numbers are for development only and must not be compared with the
Pavilion numbers.

### Effect of `-O2` (4 Nov 2026)

Same source, built by hand with and without `-O2`, timed with
`./pricer 1 --bench` and `./pricer 4 --bench`. The battery was nearly empty
and later rounds were throttled, so only the first round is shown:

| Build | 1 thread | 4 threads |
|---|---|---|
| `g++ -std=c++17` (no `-O2`, same as the VS Code run button) | 910 ms | 267 ms |
| `g++ -std=c++17 -O2 -pthread` | 392 ms | 111 ms |

Earlier `-O2` runs on a charged battery (1–3 Nov 2026) gave about 277 ms
single-threaded and 95 ms with 4 threads. So the "about 900 → 250 ms" seen
at one point matches a build **without** `-O2`, and "277 → 95 ms" matches a
build **with** `-O2`.

**Correction:** an earlier version of this file said the Mac's per-path
cost (~92 ns/path, from 1,000,000,000 paths in ~92,000 ms) was similar to
the Linux baseline (~81 ns/path). That Mac figure matches the unoptimised
build (~91 ns/path above), not `-O2` (~28–39 ns/path). The comparison is
withdrawn and must not be used as validation.

## Later stages

| Version | Paths | Time | Speedup vs. 1 thread |
|---|---|---|---|
| Faster RNG (Box-Muller + xorshift/PCG) | 10,000,000 | | |
| + `-O3 -march=native` | 10,000,000 | | |
| + SIMD | 10,000,000 | | |
| + Variance reduction | *fewer paths, same accuracy* | | |
