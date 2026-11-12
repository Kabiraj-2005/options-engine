# Engine interface

What the `pricer` binary actually does today, and what the rest of the
system expects from it.

*(This file was added on 4 Nov 2026. `ISSUES.md` already referred to it,
but no earlier version exists in the repository.)*

## What the program does now (branch `engine-inputs`, 11 Nov 2026)

```
./pricer <threads> [--bench] [--seed N] [--paths N]
         [--S X] [--K X] [--T X] [--r X] [--v X] [--put] [--json]
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

Decimals may be written as `0.25`, `1400` or `1e-3`. Text with anything
after the number (`0.25abc`), `nan` and `inf` are rejected. Without any
of the contract options the program prices the reference contract
(S=1400, K=1500, T=0.25, r=0.06, v=0.30, European call, exact price
52.6884), exactly as before.

The "Black-Scholes price (exact)" line in normal output is the call or put
price to match `--put`.

Normal output of `./pricer 4` (several lines, for people). This is a real
run on the Mac (development machine), so the times are only an example of
the format:

```
Paths: 10000000   Base seed: 42
Black-Scholes price (exact):      52.6884
Monte Carlo, single-threaded:     52.6928 +/- 0.0343   time 307.428 ms
Monte Carlo, multithreaded:       52.6983 +/- 0.0343   time 95.065 ms   (4 threads)
95% interval (multithreaded):     52.6311 to 52.7654
Speedup (this single run, not the official benchmark): 3.23x
```

`+/-` is one standard error; the 95% interval is price ± 1.96 standard
errors.

`--bench` output (exactly one line, for scripts), format:

```
threads=4 price=52.6983 std_err=0.0343 time_ms=<time>
```

`--json` output (exactly one line, for the backend). A real run on the
Mac, so the time is only an example:

```
{"price":52.698276,"stderr":0.034265,"ci95":[52.631117,52.765434],"reference":52.688447,"elapsedMs":118.876,"paths":10000000,"threads":4}
```

| Field | Meaning |
|---|---|
| `price` | multithreaded Monte Carlo price |
| `stderr` | its standard error |
| `ci95` | 95% interval, `[price − 1.96·stderr, price + 1.96·stderr]` |
| `reference` | exact Black-Scholes price (call or put, matching `--put`) |
| `elapsedMs` | time for the Monte Carlo pricing only, in milliseconds |
| `paths`, `threads` | what was used |

The field names match the `result` object in `frontend/js/api.js`, so the
backend can pass the line on unchanged. `delta` is not included yet. Once
the backend uses this line, the field names must not change.

Errors: a missing or invalid number, or an unknown option, prints a usage
message to stderr and exits with code 1. If the threads cannot be started,
it prints `error: ...` to stderr and exits with code 1.

## What the rest of the system expects

The frontend (`frontend/js/api.js`, in `main` since PR #2) expects a
backend job to send `params: { type, S, K, T, r, v, n, method }` and get
back `result: { price, stderr, ci95, delta, elapsedMs, paths, threads,
reference }`.

## Mismatch (open, ISSUES #4)

| Expected | Engine today |
|---|---|
| Takes S, K, T, r, v (and `n`) as inputs | **Done (11 Nov 2026):** `--S --K --T --r --v --paths` |
| Option `type` | **Done (11 Nov 2026):** call by default, `--put` for a put |
| Option `method` (`mc` or `bs`) | Normal output always prints both the exact Black-Scholes price and Monte Carlo; `--bench` prints Monte Carlo only |
| Returns standard error / 95% interval | **Done (8 Nov 2026).** Standard error in both outputs; 95% interval in normal output (price ± 1.96 × std_err) |
| Returns delta | Not computed |
| Machine-readable output | **Done (12 Nov 2026):** `--json` prints the `result` object (all fields except `delta`) |

The engine now takes the five inputs and the option type and prints JSON.
The backend (Node.js, being written by Utpal since 10 Nov 2026) will run
`./pricer <threads> --json ...` and pass the line on. Still missing on the
engine side: `delta`.
