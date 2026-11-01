# options-engine frontend

Static HTML, CSS and JavaScript. No build step, no framework, no dependencies
beyond one Google Font. Open `index.html` in a browser, or serve the folder
with anything (`python3 -m http.server`).

```
index.html      landing page: what the engine does, benchmarks, roles, team
app.html        the platform: price an option, job queue, dashboard, admin
css/styles.css  all styling, one file
js/landing.js   hero simulation (real GBM paths + live Monte Carlo readout)
js/api.js       API client. Mock engine in a Web Worker until the backend exists
js/app.js       platform behaviour
```

## Wiring it to the backend (Harsh)

Set `OE.config.baseUrl` at the top of `js/api.js` to the backend origin.
The client then expects:

| Endpoint | Body / returns |
|---|---|
| `POST /jobs` | body `{ params, submittedBy }`, returns a job |
| `GET /jobs` | array of jobs, newest first |
| `GET /jobs/:id` | one job |
| `DELETE /jobs/:id` | cancels a queued job, 204 |
| `GET /health` | `{ ok, threads }` |

A job looks like this (also documented at the top of `js/api.js`):

```
{ id, status: 'queued'|'running'|'done'|'failed', progress,
  submittedAt, startedAt, finishedAt, submittedBy,
  params: { type, S, K, T, r, v, n, method },
  result: { price, stderr, ci95:[lo,hi], delta, elapsedMs, paths, threads, reference } }
```

`reference` is the Black-Scholes price for the same inputs; the engine (or the
backend) should compute it so the dashboard can show error vs exact.

## Until then

With `baseUrl` empty the page runs the same Monte Carlo the C++ engine does,
inside a Web Worker, so every screen is demoable today. The yellow notice at
the top of the platform says so; it disappears once a real backend answers.
