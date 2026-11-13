/* options-engine API client.

   Two modes, chosen by OE.config.baseUrl:
     ''            -> in-browser mock. Jobs run in a Web Worker doing the same
                      Monte Carlo the C++ engine does, so the UI still works
                      when the page is opened as a plain file.
     'http://...'  -> real backend (backend/server.js), which runs the C++
                      engine. Used automatically when the page is served over
                      http, e.g. http://localhost:10241/app.html. Endpoints are
                      listed in ENDPOINTS below; the shape of a job object is
                      the contract between the two sides.

   Job object:
   {
     id, status: 'queued'|'running'|'done'|'failed',
     submittedAt, startedAt, finishedAt,          // ISO strings
     submittedBy,                                 // role name for now
     params: { type:'call'|'put', S, K, T, r, v, n, method:'mc'|'bs' },
     result: { price, stderr, ci95:[lo,hi], delta, elapsedMs, paths, threads, reference }
   }
   (the real engine also sends referenceDelta, the exact Black-Scholes delta)
*/

window.OE = (function () {
  var config = {
    // Served by the backend (http) -> talk to it; opened as a file -> mock.
    baseUrl: (location.protocol === 'http:' || location.protocol === 'https:') ? location.origin : '',
    pollMs: 900,
    // nsPerPath is per thread, chosen so the estimate for 10M paths on 4
    // threads matches the official HP Pavilion median (234.451 ms).
    engine: { threads: 4, nsPerPath: 94, maxPaths: 100000000 }
  };

  var ENDPOINTS = {
    submit: 'POST /jobs',
    list:   'GET  /jobs',
    get:    'GET  /jobs/:id',
    cancel: 'DELETE /jobs/:id',
    health: 'GET  /health'
  };

  /* ---------- maths shared by preview + mock ---------- */
  function ncdf(x) {
    // Hart (1968) rational approximation, accurate to about 1e-14
    var ax = Math.abs(x), c;
    if (ax > 37) c = 0;
    else {
      var e = Math.exp(-ax * ax / 2);
      if (ax < 7.07106781186547) {
        var b = 3.52624965998911e-02 * ax + 0.700383064443688;
        b = b * ax + 6.37396220353165; b = b * ax + 33.912866078383; b = b * ax + 112.079291497871;
        b = b * ax + 221.213596169931; b = b * ax + 220.206867912376;
        c = e * b;
        b = 8.83883476483184e-02 * ax + 1.75566716318264;
        b = b * ax + 16.064177579207; b = b * ax + 86.7807322029461; b = b * ax + 296.564248779674;
        b = b * ax + 637.333633378831; b = b * ax + 793.826512519948; b = b * ax + 440.413735824752;
        c = c / b;
      } else {
        var t = ax + 0.65;
        t = ax + 4 / t; t = ax + 3 / t; t = ax + 2 / t; t = ax + 1 / t;
        c = e / t / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  }
  // Quick in-browser estimate of the discounted payoff's standard deviation,
  // used to put an honest error bar on the preview before the engine runs.
  function payoffSd(type, S, K, T, r, v, n) {
    n = n || 40000;
    var drift = (r - 0.5 * v * v) * T, vol = v * Math.sqrt(T), disc = Math.exp(-r * T);
    var sum = 0, sq = 0;
    for (var i = 0; i < n; i++) {
      var u = 1 - Math.random(), w = Math.random();
      var z = Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * w);
      var st = S * Math.exp(drift + vol * z);
      var pay = type === 'call' ? Math.max(st - K, 0) : Math.max(K - st, 0);
      sum += pay; sq += pay * pay;
    }
    var m = sum / n;
    return disc * Math.sqrt(Math.max(sq / n - m * m, 0));
  }
  function blackScholes(type, S, K, T, r, v) {
    if (T <= 0) return Math.max(type === 'call' ? S - K : K - S, 0);
    var d1 = (Math.log(S / K) + (r + 0.5 * v * v) * T) / (v * Math.sqrt(T));
    var d2 = d1 - v * Math.sqrt(T);
    if (type === 'call') return S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
    return K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
  }
  function bsDelta(type, S, K, T, r, v) {
    var d1 = (Math.log(S / K) + (r + 0.5 * v * v) * T) / (v * Math.sqrt(T));
    return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
  }
  function estimateMs(n) {
    return (n * config.engine.nsPerPath / 1e6) / config.engine.threads;
  }

  /* ---------- real backend ---------- */
  function http(method, path, body) {
    return fetch(config.baseUrl + path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error(method + ' ' + path + ' failed: ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  /* ---------- mock backend ---------- */
  var mock = { jobs: [], seq: 1, busy: false };

  // Worker source: terminal-price Monte Carlo with Box-Muller normals,
  // mirroring src/pricer.cpp. Delta by repricing at S and S+1 with the
  // same random draws (common random numbers) so the difference is stable.
  var workerSrc = [
    'self.onmessage = function (e) {',
    '  var p = e.data, S = p.S, K = p.K, T = p.T, r = p.r, v = p.v, n = p.n, call = p.type === "call";',
    '  var drift = (r - 0.5 * v * v) * T, vol = v * Math.sqrt(T), disc = Math.exp(-r * T);',
    '  var sum = 0, sq = 0, sumUp = 0, t0 = performance.now(), CH = 250000;',
    '  for (var i = 0; i < n; i += 2) {',
    '    var u1 = 1 - Math.random(), u2 = Math.random();',
    '    var m = Math.sqrt(-2 * Math.log(u1));',
    '    var z1 = m * Math.cos(6.283185307179586 * u2), z2 = m * Math.sin(6.283185307179586 * u2);',
    '    var g1 = Math.exp(drift + vol * z1), g2 = Math.exp(drift + vol * z2);',
    '    var a = S * g1, b = S * g2, a2 = (S + 1) * g1, b2 = (S + 1) * g2;',
    '    var pa = call ? Math.max(a - K, 0) : Math.max(K - a, 0);',
    '    var pb = call ? Math.max(b - K, 0) : Math.max(K - b, 0);',
    '    sum += pa + pb; sq += pa * pa + pb * pb;',
    '    sumUp += (call ? Math.max(a2 - K, 0) : Math.max(K - a2, 0)) + (call ? Math.max(b2 - K, 0) : Math.max(K - b2, 0));',
    '    if ((i % CH) === 0 && i) self.postMessage({ progress: i / n });',
    '  }',
    '  var mean = sum / n, varc = sq / n - mean * mean;',
    '  var se = disc * Math.sqrt(Math.max(varc, 0) / n);',
    '  self.postMessage({ done: true, price: disc * mean, stderr: se, delta: disc * (sumUp - sum) / n, elapsedMs: performance.now() - t0 });',
    '};'
  ].join('\n');
  var workerUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));

  function runNext() {
    if (mock.busy) return;
    var job = mock.jobs.find(function (j) { return j.status === 'queued'; });
    if (!job) return;
    mock.busy = true;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.progress = 0;

    var p = job.params;
    var reference = blackScholes(p.type, p.S, p.K, p.T, p.r, p.v);

    if (p.method === 'bs') {
      job.result = {
        price: reference, stderr: 0, ci95: [reference, reference],
        delta: bsDelta(p.type, p.S, p.K, p.T, p.r, p.v),
        elapsedMs: 0.01, paths: 0, threads: 1, reference: reference
      };
      finish(job);
      return;
    }

    var w = new Worker(workerUrl);
    w.onmessage = function (e) {
      if (e.data.progress !== undefined) { job.progress = e.data.progress; return; }
      var d = e.data;
      // Scale the wall-clock to what the C++ engine would take, since a JS
      // worker is not the engine. Keep the real JS time for honesty.
      job.result = {
        price: d.price, stderr: d.stderr,
        ci95: [d.price - 1.96 * d.stderr, d.price + 1.96 * d.stderr],
        delta: d.delta,
        elapsedMs: d.elapsedMs,
        estimatedEngineMs: estimateMs(p.n),
        paths: p.n, threads: config.engine.threads, reference: reference
      };
      w.terminate();
      finish(job);
    };
    w.onerror = function (err) {
      job.status = 'failed'; job.error = err.message || 'Worker error';
      job.finishedAt = new Date().toISOString();
      w.terminate(); mock.busy = false; runNext();
    };
    w.postMessage(p);
  }
  function finish(job) {
    job.status = 'done';
    job.progress = 1;
    job.finishedAt = new Date().toISOString();
    mock.busy = false;
    setTimeout(runNext, 120);
  }

  var mockApi = {
    submit: function (params, who) {
      var job = {
        id: 'J-' + String(mock.seq++).padStart(4, '0'),
        status: 'queued', submittedAt: new Date().toISOString(),
        submittedBy: who, params: params, result: null
      };
      mock.jobs.unshift(job);
      setTimeout(runNext, 250);
      return Promise.resolve(clone(job));
    },
    list: function () { return Promise.resolve(mock.jobs.map(clone)); },
    get: function (id) {
      var j = mock.jobs.find(function (x) { return x.id === id; });
      return j ? Promise.resolve(clone(j)) : Promise.reject(new Error('No job ' + id));
    },
    cancel: function (id) {
      var j = mock.jobs.find(function (x) { return x.id === id; });
      if (j && j.status === 'queued') { j.status = 'failed'; j.error = 'Cancelled'; j.finishedAt = new Date().toISOString(); }
      return Promise.resolve(null);
    },
    health: function () { return Promise.resolve({ ok: true, mode: 'browser mock', threads: config.engine.threads }); }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var realApi = {
    submit: function (params, who) { return http('POST', '/jobs', { params: params, submittedBy: who }); },
    list:   function () { return http('GET', '/jobs'); },
    get:    function (id) { return http('GET', '/jobs/' + id); },
    cancel: function (id) { return http('DELETE', '/jobs/' + id); },
    health: function () { return http('GET', '/health'); }
  };

  function api() { return config.baseUrl ? realApi : mockApi; }

  return {
    config: config,
    ENDPOINTS: ENDPOINTS,
    blackScholes: blackScholes,
    bsDelta: bsDelta,
    payoffSd: payoffSd,
    estimateMs: estimateMs,
    submit: function (p, who) { return api().submit(p, who); },
    list:   function () { return api().list(); },
    get:    function (id) { return api().get(id); },
    cancel: function (id) { return api().cancel(id); },
    health: function () { return api().health(); },
    isMock: function () { return !config.baseUrl; }
  };
})();
