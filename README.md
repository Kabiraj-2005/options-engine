# options-engine

Monte Carlo options pricing engine in C++ (UCS503 project). It prices
European calls and puts with the Black-Scholes formula (exact answer) and
with Monte Carlo simulation split across threads, and reports the standard
error and delta. A small Node.js backend runs the engine for the web
platform in `frontend/`.

## Quick start (the whole platform)

```
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
node backend/server.js
```

Then open `http://localhost:10241/app.html` and sign in. On first start the
server creates three demo accounts (`analyst`, `risk`, `admin`) and writes
their passwords to `data/demo-passwords.txt`. Manage accounts with
`node backend/users.js`. Job history, settings and accounts are saved in
`data/` (not in git), so they survive a restart. Stop the server with
Ctrl+C.

Needs `g++` and Node.js (no npm packages). Details in `INTERFACE.md`.

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
         [--S X] [--K X] [--T X] [--r X] [--v X] [--put] [--json] [--exact]
```

- `<threads>`: number of threads, a whole number of 1 or more (required).
- `--bench`: run only the multithreaded pricer and print one line,
  e.g. `threads=4 price=52.6983 std_err=0.0343 time_ms=241.447`.
- `--seed N`: base seed, a whole number of 0 or more (default 42). Thread
  `t` uses seed `N + t`.
- `--paths N`: number of paths, a whole number of 1 or more
  (default 10,000,000).
- `--S X`, `--K X`, `--T X`, `--v X`: share price, strike, years to
  expiry and volatility, each a decimal above 0 (defaults 1400, 1500, 0.25,
  0.30).
- `--r X`: risk-free rate, a decimal that may be 0 or negative
  (default 0.06).
- `--put`: price a put instead of a call.
- `--json`: run only the multithreaded pricer and print one JSON line
  (price, standard error, 95% interval, delta, exact reference price and
  delta, time, paths, threads) for the backend. Format in `INTERFACE.md`.
- `--exact`: no simulation; print the Black-Scholes price and delta in the
  same JSON format.

Example (a textbook contract, exact price 8.0214):

```
./pricer 4 --S 100 --K 105 --T 1 --r 0.05 --v 0.2
```

Without `--bench` it prints the exact Black-Scholes price, the
single-threaded and multithreaded Monte Carlo prices (each with its
standard error) and times, the 95% interval of the multithreaded price,
its delta next to the exact Black-Scholes delta, and that run's speedup
(one run, not the official benchmark).

Anything invalid (missing thread count, `0`, `-1`, `abc`, `8abc`, `nan`,
`inf`, an unknown option, a missing value) prints a usage message to
stderr and exits with code 1.

Without contract options it prices the reference call: S=1400, K=1500,
T=0.25, r=0.06, v=0.30 (exact price 52.6884). See `INTERFACE.md`.

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
