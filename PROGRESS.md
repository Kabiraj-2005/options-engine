# Progress Log

## Done

- **Project selected and bid submitted.** Options Pricing and Risk
  Analytics Platform ranked as first choice on the UCS503 software bid
  form, ahead of three backup topics.
- **Repository set up (18 Aug 2026).** Git initialised, GitHub repo
  created at `Kabiraj-2005/options-engine`, `.gitignore` in place,
  collaborator workflow (clone/branch/PR) established.
- **Black-Scholes formula implemented and verified (18 Aug 2026).**
  Closed-form European call pricer in C++, output checked by hand:
  **52.6884** for the reference inputs (S=1400, K=1500, T=0.25, r=0.06,
  v=0.30). This is the exact-answer reference used to validate everything
  else.
- **Monte Carlo pricer implemented (26 Aug 2026).** Simulates random future
  prices and averages the discounted payoff. Single runs gave **52.8503**
  at 1,000,000 paths and **52.6928** at 10,000,000 paths.
- **First speed measurement (26 Aug 2026).** 10,000,000 paths,
  single-threaded, `-O2`: **810.05 ms** on the HP Pavilion. Historical
  only; see `BENCHMARKS.md`.
- **Requirement and Feasibility Study completed** and submitted, covering
  actors, functional/non-functional requirements, technical/operational/
  economic/schedule/legal feasibility, and risk analysis.
- **Starter frontend produced (1 Nov 2026)** on branch `frontend-starter`
  (static landing page + platform with pricing form, job queue, dashboard
  and admin; backend contract in `frontend/js/api.js`). Waiting for Aryan's
  review (see `ISSUES.md` #3).
- **Multithreading finished (1–4 Nov 2026, branch `multithreading`).**
  - 1 Nov: path loop extracted into `simulate_chunk` (returns the sum of
    raw payoffs, takes its own seed).
  - 3 Nov: `monte_carlo_call_mt` with `std::thread`. Thread `t` uses base
    seed + `t`, the last thread takes the leftover paths, each thread writes
    its result once, and all threads are joined after they have all
    started.
  - 4 Nov: thread count, `--bench`, `--seed` and `--paths` from the command
    line, with input checking; `scripts/benchmark.sh`.
  - 4 Nov: **official scaling results** on the Pavilion (2 cores, 4 threads,
    i3-6100U): 1.99x with 2 threads, 2.91x with 4, no gain with 8. All
    prices within 52.6884 ± 0.07. See `BENCHMARKS.md`.
- **Multi-seed convergence study (4 Nov 2026).** `scripts/convergence.sh`
  with 50 seeds: RMSE 0.1084 at 1M paths and 0.0379 at 10M, close to the
  expected 0.108 and 0.034. See `BENCHMARKS.md`.
- **Mac per-path claim withdrawn (4 Nov 2026).** The old "~92 ns/path on the
  Mac, similar to Linux" figure matches a build without `-O2` (the VS Code
  run button), so it is no longer used as validation.

## Next

See `ROADMAP.md`. In short: compare JS and C++ on the same Linux machine,
profile with `perf stat`, replace the normal/RNG generation if the profile
supports it, measure `-O3 -march=native`, then time-limited AVX2 SIMD.

## Dev setup

- Code is written on the MacBook and pushed to GitHub; benchmarks are
  pulled, compiled (`g++ -std=c++17 -O2 -pthread`) and run on the HP
  Pavilion only, so all official numbers come from one machine.
- The VS Code Code Runner button builds without `-O2`; do not use its
  timings.
