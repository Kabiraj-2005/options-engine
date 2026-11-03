# Progress Log

## Done

- **Project selected and bid submitted.** Options Pricing and Risk
  Analytics Platform ranked as first choice on the UCS503 software bid
  form, ahead of three backup topics.
- **Repository set up (18 Aug 2026).** Git initialised, GitHub repo
  created at `Kabiraj-2005/options-engine`, `.gitignore` in place,
  collaborator workflow (clone/branch/PR) established.
- **Black-Scholes formula implemented and verified.** Closed-form European
  call pricer in C++, output checked by hand: **52.6884** for the
  reference inputs (S=1400, K=1500, T=0.25, r=0.06, v=0.30). This is the
  exact-answer reference used to validate everything else.
- **Monte Carlo pricer implemented.** Simulates random future prices and
  averages the discounted payoff. Single runs gave **52.8503** at
  1,000,000 paths and **52.6928** at 10,000,000 paths. Both are within
  the expected statistical error of the exact price (see `BENCHMARKS.md`),
  so the simulation is consistent with being correct. A proper multi-seed
  convergence study is still to be done (see `ISSUES.md` #1).
- **Speed baseline established.** 10,000,000 paths, single-threaded,
  `-O2`, took **810.05 ms** on the primary benchmark machine (HP Pavilion,
  Linux, 2 cores, 4 threads (i3-6100U)). See `BENCHMARKS.md`.
- **Cross-machine sanity check.** The same core loop on a MacBook Air M3
  processed 1,000,000,000 paths in ~92,000 ms (~92 ns/path), similar to
  the Linux baseline (~81 ns/path). *Needs recheck:* the Mac figure may
  have come from a build without `-O2`.
- **Requirement and Feasibility Study completed** and submitted, covering
  actors, functional/non-functional requirements, technical/operational/
  economic/schedule/legal feasibility, and risk analysis.
- **Starter frontend produced** (static landing page + platform with
  pricing form, job queue, dashboard and admin; backend contract in
  `js/api.js`). Handed to Aryan for review and ownership (see `ISSUES.md`
  #3).

## In progress

- **Multithreading (started 1 Nov 2026, branch `multithreading`).**
  Plan: extract the path loop into `simulate_chunk`, add
  `monte_carlo_call_mt` that splits paths across threads (independent
  RNG and seed per thread, one write per thread at the end), then
  benchmark 1/2/4/8 threads against the single-threaded baseline on the
  Pavilion.
  - *Done:* path loop extracted into `simulate_chunk` (returns the sum of
    raw payoffs, takes its own seed); `monte_carlo_call` now wraps it and
    still gives exactly 52.6928.
  - *Done:* `monte_carlo_call_mt` written with `std::thread`. Thread `t`
    uses seed `42 + t`, the last thread takes the leftover paths, each
    thread writes its result once, and all threads are joined after they
    have all started. Prices for 1, 2, 3, 4, 7 and 8 threads all fall
    within 52.6884 ± 0.07, and 1 thread reproduces 52.6928 exactly.
  - *Done:* thread count comes from the command line (`./pricer <threads>`,
    invalid input prints usage and exits non-zero); each run prints one
    line `threads=N price=P time_ms=T`. `scripts/benchmark.sh` builds,
    runs 1/2/4/8 threads 7 times each and reports medians, speedups and
    price checks.
  - *Next:* run `scripts/benchmark.sh` on the Pavilion for the official
    scaling numbers.

## Dev setup

- Code is written on the MacBook and pushed to GitHub; benchmarks are
  pulled, compiled (`g++ -O2 -pthread`) and run on the HP Pavilion only,
  so all official numbers come from one machine.
