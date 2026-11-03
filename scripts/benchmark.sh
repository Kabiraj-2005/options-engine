#!/usr/bin/env bash
# Builds the pricer and benchmarks it at 1, 2, 4 and 8 threads (7 runs each).
# Prints a table of median times, speedups and prices, and saves it to
# results/benchmark-<commit>.txt. Official numbers: HP Pavilion (Linux) only.
#
# Usage (from anywhere): scripts/benchmark.sh

set -euo pipefail
cd "$(dirname "$0")/.."

THREADS="1 2 4 8"
RUNS=7
EXACT=52.6884

g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer

commit=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- src/pricer.cpp)" ]; then
    commit="${commit}-dirty"   # src/pricer.cpp differs from the commit
fi

mkdir -p results
out="results/benchmark-${commit}.txt"

# Prints the median of the numbers given as arguments.
median() {
    printf '%s\n' "$@" | sort -n | awk '{ a[NR] = $1 } END {
        if (NR % 2) print a[(NR + 1) / 2]; else print (a[NR / 2] + a[NR / 2 + 1]) / 2 }'
}

{
    echo "Monte Carlo pricer benchmark"
    echo "Date:    $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Commit:  ${commit}"
    if command -v lscpu > /dev/null; then
        lscpu | grep -E '^(Model name|Socket\(s\)|Core\(s\) per socket|Thread\(s\) per core|CPU\(s\)):'
    else
        echo "Model name:  $(sysctl -n machdep.cpu.brand_string)  (no lscpu: NOT the official machine)"
        echo "Cores:       $(sysctl -n hw.physicalcpu) physical, $(sysctl -n hw.logicalcpu) logical"
    fi
    echo "Build:   g++ -std=c++17 -O2 -pthread"
    echo "Runs:    ${RUNS} per thread count, median reported"
    echo

    base_median=""
    rows=""
    for t in $THREADS; do
        times=()
        price=""
        for _ in $(seq "$RUNS"); do
            line=$(./pricer "$t")
            # line looks like: threads=4 price=52.6983 time_ms=241.447
            times+=("$(echo "$line" | sed -E 's/.*time_ms=([0-9.]+).*/\1/')")
            price=$(echo "$line" | sed -E 's/.*price=([0-9.]+).*/\1/')
        done
        med=$(median "${times[@]}")
        [ -z "$base_median" ] && base_median=$med
        rows+="$t $med $price"$'\n'
    done

    printf '%-8s %12s %9s %10s %8s  %s\n' "threads" "median_ms" "speedup" "price" "error" "check"
    printf '%s' "$rows" | while read -r t med price; do
        awk -v t="$t" -v med="$med" -v base="$base_median" -v p="$price" -v exact="$EXACT" 'BEGIN {
            err = p - exact; if (err < 0) err = -err
            if (err <= 0.07)      check = "OK"
            else if (err <= 0.14) check = "RERUN WITH ANOTHER SEED"
            else                  check = "SUSPECT BUG"
            printf "%-8s %12.3f %8.2fx %10.4f %8.4f  %s\n", t, med, base / med, p, err, check
        }'
    done
    echo
    echo "Speedup = 1-thread median / N-thread median. Error = |price - ${EXACT}|."
} | tee "$out"

echo
echo "Saved to ${out}"
