# Engine interface

What the `pricer` binary and the backend do, and how they connect to the
frontend.

*(This file was added on 4 Nov 2026. `ISSUES.md` already referred to it,
but no earlier version exists in the repository.)*

```
website (frontend/)  --HTTP-->  backend/server.js  --runs-->  ./pricer ... --json
                     <--JSON--                     <--prints-- one JSON line
```

## The engine (13 Nov 2026)

```
./pricer <threads> [--bench] [--seed N] [--paths N]
         [--S X] [--K X] [--T X] [--r X] [--v X] [--put] [--json] [--exact]
```

| Argument | Meaning | Allowed values | Default |
|---|---|---|---|
| `<threads>` | number of threads | whole number >= 1 (required) | none |
| `--bench` | print only the one-line multithreaded result | flag | off |
| `--seed N` | base seed; thread `t` uses `N + t` | whole number 0 to 4294967295 | 42 |
| `--paths N` | number of simulated paths | whole number >= 1 | 10,000,000 |
| `--S X` | share price now | decimal > 0 | 1400 |
| `--K X` | strike price | decimal > 0 | 1500 |
| `--T X` | time to expiry in years | decimal > 0 | 0.25 |
| `--r X` | risk-free interest rate (0.06 = 6%) | any finite decimal, may be 0 or negative | 0.06 |
| `--v X` | volatility (0.30 = 30%) | decimal > 0 | 0.30 |
| `--put` | price a put instead of a call | flag | off (call) |
| `--json` | print only one JSON line (for the backend); takes priority over `--bench` | flag | off |
| `--exact` | no simulation: Black-Scholes price and delta as one JSON line; takes priority over `--json` | flag | off |

Decimals may be written as `0.25`, `1400` or `1e-3`. Text with anything
after the number (`0.25abc`), `nan` and `inf` are rejected. Without any
of the contract options the program prices the reference contract
(S=1400, K=1500, T=0.25, r=0.06, v=0.30, European call, exact price
52.6884).

Normal output of `./pricer 4 --paths 1000000` (several lines, for people).
A real run on the Mac (development machine), so the times are only an
example of the format:

```
Paths: 1000000   Base seed: 42
Black-Scholes price (exact):      52.6884
Monte Carlo, single-threaded:     52.8503 +/- 0.1087   time 29.971 ms
Monte Carlo, multithreaded:       52.5970 +/- 0.1081   time 9.612 ms   (4 threads)
95% interval (multithreaded):     52.3851 to 52.8089
Delta (multithreaded):            0.3877   Black-Scholes delta: 0.3878
Speedup (this single run, not the official benchmark): 3.12x
```

`+/-` is one standard error; the 95% interval is price ± 1.96 standard
errors. The Black-Scholes lines are for a call or a put, matching `--put`.

`--bench` output (exactly one line, for `scripts/benchmark.sh`):

```
threads=4 price=52.6983 std_err=0.0343 time_ms=<time>
```

`--json` output (exactly one line, for the backend). A real run on the
Mac, so the time is only an example:

```
{"price":52.698276,"stderr":0.034265,"ci95":[52.631117,52.765434],"delta":0.387934,"reference":52.688447,"referenceDelta":0.387840,"elapsedMs":95.943,"paths":10000000,"threads":4}
```

| Field | Meaning |
|---|---|
| `price` | multithreaded Monte Carlo price |
| `stderr` | its standard error |
| `ci95` | 95% interval, `[price − 1.96·stderr, price + 1.96·stderr]` |
| `delta` | Monte Carlo delta (pathwise method, see `BENCHMARKS.md`) |
| `reference` | exact Black-Scholes price (call or put, matching `--put`) |
| `referenceDelta` | exact Black-Scholes delta |
| `elapsedMs` | time for the pricing only, in milliseconds |
| `paths`, `threads` | what was used |

`--exact` prints the same fields with `price` = `reference`, `stderr` 0,
`ci95` = `[price, price]`, `delta` = `referenceDelta`, `paths` 0 and
`threads` 1. It is used for the frontend's "Black-Scholes" method.

The field names match the `result` object in `frontend/js/api.js`, so the
backend passes the line on unchanged. **They must not change**; the
frontend reads them by name.

Errors: a missing or invalid number, or an unknown option, prints a usage
message to stderr and exits with code 1. If the threads cannot be started,
it prints `error: ...` to stderr and exits with code 1.

## The backend (`backend/server.js`, 13 Nov 2026)

Node.js, built-in modules only (nothing to install). Run from the project
folder after building the engine:

```
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
node backend/server.js
```

It listens on port **10241** (from roll number 1024170034; override with
`PORT=...`) and runs the engine with **4 threads** (override with
`THREADS=...`). It also serves the frontend, so the platform is at
`http://localhost:10241/app.html`.

| Endpoint | Does | Replies |
|---|---|---|
| `GET /health` | is the server up? | `{ok, mode, threads, engineBuilt, busy}` |
| `POST /jobs` | body `{params, submittedBy}`; checks the params and queues a job | 201 + the job, or 400 + `{error}` |
| `GET /jobs` | all jobs, newest first | array of jobs |
| `GET /jobs/:id` | one job | the job, or 404 |
| `DELETE /jobs/:id` | cancels a queued job | 204; 409 if it is no longer queued; 404 if unknown |

`params` is `{type: "call"|"put", method: "mc"|"bs", S, K, T, r, v, n}`.
S, K, T and v must be above 0, r any number, and for `mc`, n a whole number
from 1,000 to 100,000,000.

How a job runs:

- Jobs run **one at a time**, oldest first. Each run already uses all 4
  threads, so running several at once would only slow all of them down.
- `mc` runs `./pricer 4 --json --S .. --K .. --T .. --r .. --v .. --paths n
  --seed <job number> [--put]`. Each job uses its job number as the seed, so
  repeating a contract gives an independent run. The seed is stored in the
  job (`seed`) so any result can be reproduced from the command line.
- `bs` runs `./pricer 4 --exact ...` (no simulation).
- The arguments are passed as a list (`execFile`), never through a shell,
  so nothing typed into the website can run as a command.
- The job's `result` is the engine's JSON line. If the engine fails, the job
  becomes `failed` with an `error` message; the server keeps running.
- Jobs are kept in memory only (they are lost when the server stops); the
  oldest finished jobs are dropped after 500.

## The frontend

`frontend/js/api.js` talks to the backend automatically when the page is
served over http (by the backend), and falls back to an in-browser mock
engine when the page is opened as a file. See `frontend/README.md`.

All fields the frontend expects are now provided (ISSUES #4, resolved
13 Nov 2026), except `progress` for running jobs, which the engine does
not report; running jobs simply show "Running".
