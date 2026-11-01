# Issues

Known problems and open questions. Add a dated entry when something is
found; move it to "Resolved" when the fix is merged and the affected doc
is updated.

## Open

### 1. Convergence has only been shown with single runs
*Found 15 Sep 2026. Owner: Utpal.*

Earlier drafts claimed a 10x increase in paths cut the error by roughly
36x and called this "consistent with 1/√n". It is not: 1/√n predicts a
reduction of about √10 ≈ 3.2x. The 36x came from one lucky run.

| Paths | Standard error | 95% band | Measured error | Verdict |
|---|---|---|---|---|
| 1,000,000 | ~0.108 | ±0.21 | 0.1619 | normal |
| 10,000,000 | ~0.034 | ±0.067 | 0.0044 | lucky, well inside the band |

The "36x" wording has been removed from `BENCHMARKS.md` and
`PROGRESS.md` (1 Nov 2026). Do not put it in the SRS.

**Still to do**

- Run each path count with 10 or more different seeds and report the mean
  absolute error and the standard error.
- Have the engine return the standard error alongside the price (planned
  in `INTERFACE.md` as the "accuracy/confidence figure").

### 2. The single-threaded engine is about 2x slower than it should be
*Found 15 Sep 2026. Owner: Utpal.*

The baseline is 810 ms for 10M paths (~81 ns/path) at `-O2`. A JavaScript
Web Worker running the same terminal-price Monte Carlo (Box-Muller normals,
`Math.random`) did 10M paths in roughly 400 ms on comparable hardware.

Most likely cause is normal-number generation:

- `std::normal_distribution` uses Marsaglia polar sampling with rejection,
  several times the cost of a Box-Muller pair.
- `std::mt19937` is not fast; a 64-bit xorshift or PCG variant is a few
  instructions per draw.
- Drift, volatility and discount factor should be computed once, outside
  the loop.

**What to do**

- Profile on the Pavilion first (`perf stat` or a timer around the RNG
  loop).
- Replace `std::normal_distribution` with Box-Muller and try a faster RNG.
- Re-measure and re-baseline in `BENCHMARKS.md`, then re-run the thread
  scaling benchmark. (Decision, 29 Oct 2026: threading is being done
  first; the speedup ratio stays valid and will be re-measured after this
  fix.)

### 3. Frontend ownership
*Noted 15 Sep 2026. Owner: Aryan.*

A complete static frontend (landing page plus platform with pricing form,
job queue, dashboard and admin) exists, along with the backend contract
in `js/api.js`. It was produced outside Aryan's branch. It goes into the
repo on branch `frontend-starter` via a pull request for Aryan to review,
keep or rewrite, and own from there.

## Resolved

*(nothing yet)*
