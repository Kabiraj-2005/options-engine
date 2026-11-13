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

## The backend (`backend/`, 13 Nov 2026)

Node.js, built-in modules only (nothing to install), in three files:
`server.js` (routes and the job queue), `store.js` (saving to disk) and
`users.js` (accounts). Run from the project folder after building the
engine:

```
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
node backend/server.js
```

It listens on port **10241** (from roll number 1024170034; override with
`PORT=...`). It also serves the frontend, so the platform is at
`http://localhost:10241/app.html`. Stop it with Ctrl+C; a running engine
process is stopped with it.

### Signing in and roles

Every request except `/health` and `/login` needs a signed-in user: the
browser sends `Authorization: Bearer <token>`, where the token came from
`POST /login`. Tokens are random, kept in the server's memory for 12 hours,
and forgotten on restart (everyone signs in again).

| Role | Can |
|---|---|
| `analyst` | price options, see jobs, cancel jobs |
| `risk` | see jobs and the dashboard only |
| `admin` | everything, plus engine settings and the account list |

The server checks the role on every request, so hiding a page in the
browser is not the only protection: a risk manager who calls `POST /jobs`
directly gets 403.

Accounts are in `data/users.json` (one copy per computer, not in git).
Passwords are not stored: each account has a random salt and the scrypt
hash of salt + password. A hash is one-way: it can check a typed password
but cannot be turned back into it.

**Team accounts.** `backend/seed-users.json` is tracked in git and holds
12 accounts, one per team member per role (`utpal`, `harsh`, `aryan`,
`arya` × `.analyst`, `.risk`, `.admin`, display names like
"Harsh (Risk Manager)"), as username, name, role, salt and hash only. On
every start the server copies any of them that this computer's
`data/users.json` does not have yet, matching by username. Existing local
accounts are never overwritten or deleted, so a password changed locally
stays changed. The passwords are random but easy to type: two common
words and four digits, like `tiger-maple-4821` (about 635 million
possibilities, roughly 29 bits; with scrypt's deliberately slow hashing,
guessing one from its hash takes a long time). They are sent to each
person privately.

`node backend/users.js seed` makes new passwords for all 12 accounts: it
rewrites `backend/seed-users.json` and writes the passwords to
`data/team-passwords.txt` (not in git, readable only by its owner). Commit
the new seed file; each computer picks up accounts it does not have on its
next start. (An account a computer already has keeps its old password
there; remove it with `node backend/users.js remove <username>` and
restart to take the new one.)

**Demo accounts.** Only when there is no seed file and no local account at
all does the server create `analyst`, `risk` and `admin` with random
passwords, written to `data/demo-passwords.txt`.

Manage accounts on one computer with:

```
node backend/users.js list
node backend/users.js add <username> <role> <password> [display name]
node backend/users.js remove <username>
node backend/users.js seed
```

### Endpoints

| Endpoint | Who | Does | Replies |
|---|---|---|---|
| `GET /health` | anyone | is the server up? | `{ok, mode, threads, maxPaths, engineBuilt, busy, signInRequired}` |
| `POST /login` | anyone | body `{username, password}` | `{token, user}`, or 401 |
| `POST /logout` | signed in | ends the session | 204 |
| `GET /me` | signed in | who am I | `{username, name, role}` |
| `POST /jobs` | analyst, admin | body `{params}`; checks the params and queues a job | 201 + the job, or 400 + `{error}` |
| `GET /jobs` | signed in | all jobs, newest first | array of jobs |
| `GET /jobs/:id` | signed in | one job | the job, or 404 |
| `DELETE /jobs/:id` | analyst, admin | cancels a queued **or running** job | 204; 409 if it already finished; 404 if unknown |
| `GET /admin/settings` | admin | engine settings | `{threads, maxPaths}` |
| `PUT /admin/settings` | admin | body `{threads, maxPaths}` (1–64 threads, 1,000 to 1,000,000,000 paths) | the new settings, or 400 |
| `GET /admin/users` | admin | accounts | `[{username, name, role}]` (no password data) |

Not signed in: 401. Wrong role: 403.

`params` is `{type: "call"|"put", method: "mc"|"bs", S, K, T, r, v, n}`.
S, K, T and v must be above 0, r any number, and for `mc`, n a whole number
from 1,000 to the `maxPaths` setting (default 100,000,000).

### How a job runs

- Jobs run **one at a time**, oldest first. Each run already uses all the
  engine threads, so running several at once would only slow all of them.
- `mc` runs `./pricer <threads> --json --S .. --K .. --T .. --r .. --v ..
  --paths n --seed <job number> [--put]`; `bs` runs `./pricer <threads>
  --exact ...` (no simulation). `<threads>` is the admin setting (default 4,
  the Pavilion's logical CPUs); the job records it in `threads`.
- Each job uses its job number as the seed, so repeating a contract gives an
  independent run. The seed is stored in the job (`seed`), so any result can
  be reproduced from the command line.
- The arguments are passed as a list (`execFile`), never through a shell,
  so nothing typed into the website can run as a command.
- The job's `result` is the engine's JSON line. If the engine fails, the job
  becomes `failed` with an `error` message; the server keeps running.
- Cancelling a running job stops the engine process at once; the job
  becomes `failed` with error `Cancelled`.
- `submittedBy` is the signed-in account's name (set by the server).

### Saved data (`data/`, not in git)

| File | Holds |
|---|---|
| `jobs.json` | job history; reloaded on start. Job numbers (and so seeds) carry on from the highest saved one. A job that was running when the server stopped is marked `failed` ("Server stopped while this job was running"); queued jobs run when the server starts again. The oldest finished jobs are dropped after 500. |
| `settings.json` | `threads` and `maxPaths` from the admin page (`THREADS=...` overrides threads at start) |
| `users.json` | accounts (hashed passwords) |
| `team-passwords.txt` | only on the computer that ran `users.js seed`: the team passwords, to send privately |
| `demo-passwords.txt` | only if demo accounts were created (no team accounts): their passwords |

Files are written to a temporary file and then renamed, so a crash cannot
leave half a file. A file that cannot be read is renamed aside, not
overwritten. `DATA_DIR=...` puts the folder elsewhere.

## The frontend

`frontend/js/api.js` talks to the backend automatically when the page is
served over http (by the backend): the platform then shows a sign-in form,
and the account's role decides which pages appear. Opened as a file, it
falls back to an in-browser mock engine with a role drop-down instead. See
`frontend/README.md`.

All fields the frontend expects are now provided (ISSUES #4, resolved
13 Nov 2026), except `progress` for running jobs, which the engine does
not report; running jobs simply show "Running".
