# Roadmap

Pricing engine stages, in order. Official speed numbers come from the
HP Pavilion (Linux, i3-6100U, 2 cores / 4 threads) only.

*(This file was added on 4 Nov 2026; no earlier version exists in the
repository.)*

## Finished

- [x] Black-Scholes reference price (18 Aug 2026)
- [x] Single-threaded Monte Carlo pricer (26 Aug 2026)
- [x] Multithreading with `std::thread`, benchmarked on the Pavilion
      (finished 4 Nov 2026). **This was planned for October 2026 and
      slipped into November.**
- [x] Multi-seed convergence study (4 Nov 2026)

## Next, in this order

1. [ ] **Compare JS and C++ on the same Linux machine.** The claim that the
       JS Web Worker is faster (ISSUES #2) is unproven until both run on
       the Pavilion with the same path count.
2. [ ] **Profile with `perf stat`** on the Pavilion to see where the time
       goes (random numbers, `exp`, or something else).
3. [ ] **Replace the normal/RNG generation** (`std::normal_distribution` /
       `std::mt19937`) only if the profile shows it is the bottleneck.
       Re-baseline afterwards.
4. [ ] **Measure `-O3 -march=native`** against `-O2`.
5. [ ] **Hand-written AVX2 SIMD**, Linux only, time-limited. Stop at the
       time limit even if it is unfinished.

## Must not slip because of SIMD

- [ ] **Delta** (option sensitivity), which the frontend expects in its
      results (see `INTERFACE.md`).
- [ ] **Antithetic variates** (variance reduction).

These are needed features. SIMD is an optimisation and comes second if
time runs short.

## Also open

- [x] Engine returns the standard error with the price (ISSUES #1, done
      8 Nov 2026; Pavilion timing still to be re-measured).
- [ ] Engine takes the contract inputs instead of the fixed reference
      contract (ISSUES #4, `INTERFACE.md`).
