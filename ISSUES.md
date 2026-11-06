# Issues

Known problems and open questions. Add a dated entry when something is
found; move it to "Resolved" when the fix is merged and the affected doc
is updated.

## Open

### 1. The engine does not return its standard error
*Found 15 Sep 2026. Owner: Utpal.*

The multi-seed measurement part of this issue is done (see Resolved, 1a).
What is left: have the engine return the standard error (and a 95%
interval) alongside the price, as the frontend expects (`INTERFACE.md`).
This changes the hot loop (it needs the sum of squared payoffs), so it is
not done yet.

### 2. Is the C++ engine slower than the JavaScript version?
*Found 15 Sep 2026. Owner: Utpal.*

The historical single-threaded figure was 810 ms for 10M paths at `-O2`
(26 Aug 2026); the 1-thread time on 4 Nov 2026 was 681.787 ms, for reasons
not yet known. A JavaScript Web Worker running the same terminal-price
Monte Carlo (Box-Muller normals, `Math.random`) was reported to do 10M paths
in roughly 400 ms, but **not on the same machine**. The comparison
(810 ms vs ~400 ms) is unproven until both run on the Pavilion.

Possible causes if C++ really is slower (not yet measured):

- `std::normal_distribution` uses Marsaglia polar sampling with rejection.
- `std::mt19937` is not the fastest generator.
- Drift and volatility terms are written inside the loop (the compiler may
  already hoist them).

**What to do** (in this order, see `ROADMAP.md`): run JS and C++ on the
Pavilion, profile with `perf stat`, and only then replace the RNG if the
profile supports it. Re-baseline in `BENCHMARKS.md` afterwards.

### 3. Frontend ownership
*Noted 15 Sep 2026. Owner: Aryan.*

A complete static frontend (landing page plus platform with pricing form,
job queue, dashboard and admin) exists, along with the backend contract
in `frontend/js/api.js`. It was produced outside Aryan's branch. It is on
branch `frontend-starter` and goes into `main` via a pull request for Aryan
to review, keep or rewrite, and own from there.

### 4. Engine interface does not match what the frontend/backend expect
*Found 4 Nov 2026. Owner: Utpal (engine), Harsh (backend).*

The engine prices only the fixed reference contract and prints text. The
frontend contract expects S, K, T, r, v, n, type and method as inputs and
price, standard error, 95% interval and delta as outputs. Full table in
`INTERFACE.md`. Not to be built as part of the threading work.

### 5. Frontend shows outdated benchmark claims
*Found 4 Nov 2026. Owner: Aryan.*

On branch `frontend-starter`, `frontend/index.html` describes the Linux
machine as "4 cores" and says the engine "splits the paths across all four
cores"; it also shows 810 ms as the single-threaded figure and the 4-thread
row as "measuring". `frontend/js/app.js` uses 810.05 ms. The machine has
2 cores / 4 threads, and the official numbers are in `BENCHMARKS.md`.

### 6. 1-thread timing gap on the Mac (clang)
*Found 4 Nov 2026. Owner: Utpal. Development machine only.*

On the Mac, `monte_carlo_call_mt` with 1 thread took about 342 ms while
`monte_carlo_call` took about 276 ms for the same work and price. Running
on a `std::thread` and the lambda capture style were ruled out; with
inlining turned off the two are equal, so it looks like a clang
code-generation difference. On Linux (GCC) the 1-thread median (681.787 ms)
is not slower than the roughly 730 ms reported for the old single-threaded
call before the 4 Nov change, so there is no sign that the official
speedups are inflated by it. Look again during profiling.

### 7. Reason for the 810 → 682 ms drop is unknown
*Found 4 Nov 2026. Owner: Utpal.*

The 26 Aug single-threaded figure (810.05 ms) and the 4 Nov 1-thread median
(681.787 ms) were not measured under the same conditions. Until the cause
is known, 810.05 ms is kept as historical only.

## Resolved

### 1a. Convergence shown with many seeds, not single runs
*Resolved 4 Nov 2026.*

Earlier drafts claimed a 10x increase in paths cut the error by roughly
36x and called this "consistent with 1/√n". It is not: 1/√n predicts
about √10 ≈ 3.2x, and the 36x came from one lucky run. That wording was
removed on 1 Nov 2026 and must not be used as evidence anywhere.
`scripts/convergence.sh` (50 seeds) now gives RMSE 0.1084 at 1M paths and
0.0379 at 10M, a 2.86x drop, close to the expected 0.108, 0.034 and 3.2x.
See `BENCHMARKS.md`.

### 8. Mac per-path cost claim
*Resolved 4 Nov 2026.*

`BENCHMARKS.md` and `PROGRESS.md` said the Mac's ~92 ns/path matched the
Linux baseline. Measured on 4 Nov: an unoptimised build (as made by the
VS Code run button) gives ~91 ns/path on the Mac and `-O2` gives about
28–39 ns/path, so the old figure came from an unoptimised build. Claim
withdrawn.

### 9. Thread count was hardcoded
*Resolved 4 Nov 2026.*

`main` always used 4 threads, so `./pricer 1` and `./pricer 4` behaved
the same. The thread count now comes from the command line.

### 10. Compiled binary tracked in git
*Resolved 1 Nov 2026 (`5e1eb94`).*

`pricer` is no longer tracked; `.gitignore` covers `pricer`, `*.save`,
`.DS_Store` and `results/`.
