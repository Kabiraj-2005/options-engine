# options-engine frontend

Static HTML, CSS and JavaScript. No build step, no framework, no dependencies
beyond one Google Font.

To use the real C++ engine, start the backend from the project folder and
open the platform through it:

```
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
node backend/server.js
# then open http://localhost:10241/app.html
```

Opened as a plain file instead, the page falls back to the in-browser mock
engine described below.

```
index.html      landing page: what the engine does, benchmarks, roles, team
app.html        the platform: price an option, job queue, dashboard, admin
css/styles.css  all styling, one file
js/landing.js   hero simulation (real GBM paths + live Monte Carlo readout)
js/api.js       API client. Mock engine in a Web Worker until the backend exists
js/app.js       platform behaviour
```

## Wiring to the backend

`OE.config.baseUrl` in `js/api.js` is set automatically: when the page is
served over http (by `backend/server.js`), it talks to that same server;
when it is opened as a file, it uses the mock. The backend provides:

| Endpoint | Body / returns |
|---|---|
| `POST /jobs` | body `{ params, submittedBy }`, returns a job |
| `GET /jobs` | array of jobs, newest first |
| `GET /jobs/:id` | one job |
| `DELETE /jobs/:id` | cancels a queued job, 204 (409 if it is no longer queued) |
| `GET /health` | `{ ok, mode, threads, engineBuilt, busy }` |

A job looks like this (also documented at the top of `js/api.js`):

```
{ id, status: 'queued'|'running'|'done'|'failed', progress,
  submittedAt, startedAt, finishedAt, submittedBy,
  params: { type, S, K, T, r, v, n, method },
  result: { price, stderr, ci95:[lo,hi], delta, elapsedMs, paths, threads, reference } }
```

`reference` is the Black-Scholes price for the same inputs, computed by the
C++ engine so the dashboard can show error vs exact. The real engine also
returns `referenceDelta` (exact Black-Scholes delta). There is no `progress`
from the real engine; running jobs simply show "Running".

## Mock mode

With `baseUrl` empty (page opened as a file) the page runs the same Monte
Carlo as the C++ engine inside a Web Worker, so every screen still works.
The yellow notice at the top of the platform says so.
