# Engine interface

What the `pricer` binary actually does today, and what the rest of the
system expects from it.

*(This file was added on 4 Nov 2026. `ISSUES.md` already referred to it,
but no earlier version exists in the repository.)*

## What the program does now (commit on branch `multithreading`, 4 Nov 2026)

```
./pricer <threads> [--bench] [--seed N] [--paths N]
```

| Argument | Meaning | Allowed values | Default |
|---|---|---|---|
| `<threads>` | number of threads | whole number >= 1 (required) | none |
| `--bench` | print only the one-line multithreaded result | flag | off |
| `--seed N` | base seed; thread `t` uses `N + t` | whole number 0 to 4294967295 | 42 |
| `--paths N` | number of simulated paths | whole number >= 1 | 10,000,000 |

**The contract is fixed in the code:** S=1400, K=1500, T=0.25, r=0.06,
v=0.30, European call. The program does **not** read S, K, T, r or v from
its arguments.

Normal output of `./pricer 4` (several lines, for people). This is a real
run on the Mac with a nearly empty battery, so the times are only an
example of the format:

```
Paths: 10000000   Base seed: 42
Black-Scholes price (exact):      52.6884
Monte Carlo, single-threaded:     52.6928   time 2227.028 ms
Monte Carlo, multithreaded:       52.6983   time 937.245 ms   (4 threads)
Speedup (this single run, not the official benchmark): 2.38x
```

`--bench` output (exactly one line, for scripts), format:

```
threads=4 price=52.6983 time_ms=<time>
```

Errors: a missing or invalid number, or an unknown option, prints a usage
message to stderr and exits with code 1. If the threads cannot be started,
it prints `error: ...` to stderr and exits with code 1.

## What the rest of the system expects

The frontend (`frontend/js/api.js` on branch `frontend-starter`) expects a
backend job to send `params: { type, S, K, T, r, v, n, method }` and get
back `result: { price, stderr, ci95, delta, elapsedMs, paths, threads,
reference }`.

## Mismatch (open, ISSUES #4)

| Expected | Engine today |
|---|---|
| Takes S, K, T, r, v (and `n`) as inputs | Fixed reference contract; only `n` (`--paths`) and threads can be set |
| Option `type` and `method` | Call only, Monte Carlo only |
| Returns standard error / 95% interval | Not returned (ISSUES #1) |
| Returns delta | Not computed |
| Machine-readable output | Only the `--bench` line, which has price and time |

The backend owner should not build against the five-input interface until
the engine provides it.
