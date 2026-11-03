#!/usr/bin/env bash
# Measures Monte Carlo error with many seeds (ISSUES.md #1).
# For each path count, runs the pricer with SEEDS different base seeds and
# reports the mean price, mean absolute error and root-mean-square error
# against the exact Black-Scholes price. Prices do not depend on timing, so
# this can run on any machine.
#
# Usage (from anywhere): scripts/convergence.sh
#   SEEDS=50 THREADS=4 scripts/convergence.sh   (these are the defaults)

set -euo pipefail
cd "$(dirname "$0")/.."

SEEDS=${SEEDS:-50}
THREADS=${THREADS:-4}
PATH_COUNTS="1000000 10000000"
EXACT=52.6884
FIRST_SEED=1000

g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer

commit=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- src/pricer.cpp)" ]; then
    commit="${commit}-dirty"
fi
mkdir -p results
out="results/convergence-${commit}.txt"

{
    echo "Monte Carlo convergence study"
    echo "Date:    $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Commit:  ${commit}"
    echo "Seeds:   ${SEEDS} base seeds per path count (${FIRST_SEED}, $((FIRST_SEED + THREADS)), ...)"
    echo "Threads: ${THREADS} (thread t uses base seed + t, so no two runs share a seed)"
    echo "Exact:   ${EXACT}"
    echo

    printf '%-12s %6s %12s %10s %10s\n' "paths" "seeds" "mean_price" "mean_abs" "rmse"
    for n in $PATH_COUNTS; do
        for k in $(seq 0 $((SEEDS - 1))); do
            seed=$((FIRST_SEED + k * THREADS))
            ./pricer "$THREADS" --bench --seed "$seed" --paths "$n" | sed -E 's/.*price=([0-9.]+).*/\1/'
        done | awk -v n="$n" -v exact="$EXACT" '{
                err = $1 - exact; sum += $1; abs += (err < 0 ? -err : err); sq += err * err; k++
            } END {
                printf "%-12s %6d %12.4f %10.4f %10.4f\n", n, k, sum / k, abs / k, sqrt(sq / k)
            }'
    done
    echo
    echo "mean_abs = average of |price - exact|. rmse = sqrt(average of (price - exact)^2)."
    echo "Theory (payoff standard deviation ~108): rmse ~0.108 at 1M, ~0.034 at 10M,"
    echo "i.e. about 3.2x smaller for 10x more paths."
} | tee "$out"

echo
echo "Saved to ${out}"
