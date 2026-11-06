# options-engine

Monte Carlo options pricing engine in C++ (UCS503 project). It prices a
European call with the Black-Scholes formula (exact answer) and with Monte
Carlo simulation, single-threaded or split across threads.

## Build

```
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
```

Always build with `-O2`. Builds without it (for example the VS Code
Code Runner button) were measured at roughly 2.3–3.3x slower on the Mac,
and their timings are not valid.

## Run

```
./pricer <threads> [--bench] [--seed N] [--paths N]
```

- `<threads>`: number of threads, a whole number of 1 or more (required).
- `--bench`: run only the multithreaded pricer and print one line,
  e.g. `threads=4 price=52.6983 time_ms=241.447`.
- `--seed N`: base seed, a whole number of 0 or more (default 42). Thread
  `t` uses seed `N + t`.
- `--paths N`: number of paths, a whole number of 1 or more
  (default 10,000,000).

Without `--bench` it prints the exact Black-Scholes price, the
single-threaded Monte Carlo price and time, the multithreaded price and
time, and that run's speedup (one run, not the official benchmark).

Anything invalid (missing thread count, `0`, `-1`, `abc`, `8abc`, an
unknown option) prints a usage message to stderr and exits with code 1.

The contract is fixed: S=1400, K=1500, T=0.25, r=0.06, v=0.30 (exact price
52.6884). See `INTERFACE.md`.

## Scripts

- `scripts/benchmark.sh`: builds, runs 1/2/4/8 threads 7 times each, prints
  median times, speedups and price checks, and saves them to
  `results/benchmark-<commit>.txt`. Official numbers: HP Pavilion only.
- `scripts/convergence.sh`: runs 1M and 10M paths with 50 seeds each and
  reports mean price, mean absolute error and RMSE.

## Docs

`PROGRESS.md` (what is done), `BENCHMARKS.md` (results), `ROADMAP.md`
(what is next), `ISSUES.md` (known problems), `INTERFACE.md` (what the
binary does and what other parts expect).
