/* Platform behaviour: views, roles, the pricing form and its live preview,
   queue polling, the result drawer, dashboard charts and admin settings. */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var fmt = {
    int: function (n) { return Number(n).toLocaleString('en-US'); },
    ms: function (ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms >= 10 ? Math.round(ms) + ' ms' : ms.toFixed(2) + ' ms'; },
    p: function (x, d) { return Number(x).toFixed(d === undefined ? 4 : d); }
  };

  /* ---------- state ---------- */
  var state = {
    role: 'analyst',
    view: 'price',
    type: 'call',
    jobs: [],
    openJob: null
  };
  var ROLE_VIEWS = {
    analyst: ['price', 'queue', 'dash'],
    risk:    ['queue', 'dash'],
    admin:   ['price', 'queue', 'dash', 'admin']
  };
  var ROLE_NAME = { analyst: 'Analyst', risk: 'Risk manager', admin: 'Admin' };

  /* ---------- toast ---------- */
  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---------- views + roles ---------- */
  var navBtns = document.querySelectorAll('.side nav button');
  function showView(name) {
    if (ROLE_VIEWS[state.role].indexOf(name) < 0) name = ROLE_VIEWS[state.role][0];
    state.view = name;
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    navBtns.forEach(function (b) {
      if (b.dataset.view === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'dash') renderDash();
    if (name === 'queue') renderQueue();
  }
  navBtns.forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });

  function applyRole(role) {
    state.role = role;
    navBtns.forEach(function (b) { b.hidden = ROLE_VIEWS[role].indexOf(b.dataset.view) < 0; });
    showView(state.view);
  }
  $('role').addEventListener('change', function (e) { applyRole(e.target.value); toast('Signed in as ' + ROLE_NAME[e.target.value]); });

  /* ---------- engine status ---------- */
  OE.health().then(function (h) {
    $('engineDot').className = 'dot' + (OE.isMock() ? ' off' : '');
    if (!OE.isMock()) { OE.config.engine.threads = h.threads; renderPreview(); }
    $('engineText').textContent = OE.isMock() ? 'Browser engine, ' + h.threads + ' threads' : 'C++ engine online, ' + h.threads + ' threads';
    $('mockNotice').hidden = !OE.isMock();
  }).catch(function () {
    $('engineDot').className = 'dot off';
    $('engineText').textContent = 'Engine unreachable';
  });

  /* ---------- form: read + validate ---------- */
  var F = ['S', 'K', 'T', 'r', 'v', 'n'];
  function readParams() {
    var p = { type: state.type, method: $('method').value };
    F.forEach(function (k) { p[k] = parseFloat($(k).value); });
    p.n = Math.round(p.n);
    return p;
  }
  function validate(p) {
    var errs = {};
    if (!(p.S > 0)) errs.S = 'Share price must be above 0.';
    if (!(p.K > 0)) errs.K = 'Strike must be above 0.';
    if (!(p.T > 0)) errs.T = 'Time to expiry must be above 0.';
    if (isNaN(p.r)) errs.r = 'Enter a rate, e.g. 0.06 for 6%.';
    if (!(p.v > 0)) errs.v = 'Volatility must be above 0.';
    if (!(p.n >= 1000)) errs.n = 'Use at least 1,000 paths.';
    else if (p.n > OE.config.engine.maxPaths) errs.n = 'Above the engine cap of ' + fmt.int(OE.config.engine.maxPaths) + ' paths.';
    F.forEach(function (k) {
      $('err-' + k).textContent = errs[k] || '';
      $(k).setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
    });
    return Object.keys(errs).length === 0;
  }

  /* ---------- form: live preview ---------- */
  function renderPreview() {
    var p = readParams();
    var ok = validate(p);
    $('submitBtn').disabled = !ok;
    if (!ok) { $('submitHint').textContent = 'Fix the fields above to submit.'; return; }
    $('submitHint').textContent = '';

    var price = OE.blackScholes(p.type, p.S, p.K, p.T, p.r, p.v);
    var delta = OE.bsDelta(p.type, p.S, p.K, p.T, p.r, p.v);
    $('pvPrice').textContent = fmt.p(price);
    $('pvDelta').textContent = fmt.p(delta);
    $('pvMoney').textContent = fmt.p(p.S / p.K, 3);
    $('pvTime').textContent = p.method === 'bs' ? 'instant' : fmt.ms(OE.estimateMs(p.n));
    // 95% error bar: 1.96 x (payoff sd / sqrt n), sd from a quick browser estimate.
    var sd = p.method === 'bs' ? 0 : OE.payoffSd(p.type, p.S, p.K, p.T, p.r, p.v);
    $('pvErr').textContent = p.method === 'bs' ? 'exact' : '±' + fmt.p(1.96 * sd / Math.sqrt(p.n), 4);
    $('pvThreads').textContent = OE.config.engine.threads + ' threads';
    drawPayoff(p, price);
  }

  function drawPayoff(p, price) {
    var svg = $('payoff'), W = 320, H = 110, pad = 8;
    var lo = p.K * 0.6, hi = p.K * 1.4;
    var pts = [], maxPay = 0;
    for (var i = 0; i <= 60; i++) {
      var s = lo + (hi - lo) * i / 60;
      var pay = p.type === 'call' ? Math.max(s - p.K, 0) : Math.max(p.K - s, 0);
      pts.push([s, pay]); if (pay > maxPay) maxPay = pay;
    }
    maxPay = maxPay || 1;
    var X = function (s) { return pad + (s - lo) / (hi - lo) * (W - 2 * pad); };
    var Y = function (v) { return H - pad - v / maxPay * (H - 2 * pad - 14); };
    var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1); }).join(' ');
    var sx = X(Math.min(Math.max(p.S, lo), hi)), kx = X(p.K);
    svg.innerHTML =
      '<line x1="' + pad + '" y1="' + Y(0) + '" x2="' + (W - pad) + '" y2="' + Y(0) + '" stroke="var(--line)" />' +
      '<path d="' + d + '" fill="none" stroke="var(--sig)" stroke-width="2" />' +
      '<line x1="' + kx + '" y1="' + pad + '" x2="' + kx + '" y2="' + Y(0) + '" stroke="var(--line)" stroke-dasharray="3 4" />' +
      '<line x1="' + sx + '" y1="' + pad + '" x2="' + sx + '" y2="' + Y(0) + '" stroke="var(--paper-2)" />' +
      '<text x="' + (kx + 4) + '" y="' + (pad + 10) + '" fill="var(--mute)" font-size="10" font-family="inherit">strike</text>' +
      '<text x="' + (sx + 4) + '" y="' + (pad + 22) + '" fill="var(--paper-2)" font-size="10" font-family="inherit">now</text>' +
      '<text x="' + (W - pad) + '" y="' + (H - 1) + '" fill="var(--mute)" font-size="10" text-anchor="end" font-family="inherit">payoff at expiry vs share price</text>';
  }

  F.forEach(function (k) { $(k).addEventListener('input', renderPreview); });
  $('method').addEventListener('change', renderPreview);
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.type = b.dataset.type;
      document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      renderPreview();
    });
  });
  document.querySelectorAll('.presets button').forEach(function (b) {
    b.addEventListener('click', function () { $('n').value = b.dataset.n; renderPreview(); });
  });
  $('resetBtn').addEventListener('click', function () {
    var ref = { S: 1400, K: 1500, T: 0.25, r: 0.06, v: 0.30, n: 1000000 };
    F.forEach(function (k) { $(k).value = ref[k]; });
    $('method').value = 'mc';
    document.querySelector('.seg button[data-type="call"]').click();
  });

  /* ---------- submit ---------- */
  $('priceForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = readParams();
    if (!validate(p)) return;
    $('submitBtn').disabled = true;
    OE.submit(p, ROLE_NAME[state.role]).then(function (job) {
      toast('Submitted ' + job.id);
      $('submitBtn').disabled = false;
      refresh();
    }).catch(function (err) {
      $('submitBtn').disabled = false;
      $('submitHint').textContent = 'Could not submit: ' + err.message;
    });
  });

  /* ---------- queue ---------- */
  function contractLabel(p) {
    return (p.type === 'call' ? 'Call' : 'Put') + ' ' + p.S + ' / ' + p.K + ', T=' + p.T;
  }
  function statusPill(j) {
    var txt = { queued: 'Queued', running: 'Running', done: 'Done', failed: j.error === 'Cancelled' ? 'Cancelled' : 'Failed' }[j.status];
    if (j.status === 'running' && j.progress) txt += ' ' + Math.round(j.progress * 100) + '%';
    return '<span class="pill ' + j.status + '">' + txt + '</span>';
  }
  function renderQueue() {
    var body = $('jobsBody'), jobs = state.jobs;
    $('jobsEmpty').hidden = jobs.length > 0;
    $('jobsTable').style.display = jobs.length ? '' : 'none';
    body.innerHTML = jobs.map(function (j) {
      var r = j.result, p = j.params;
      var canCancel = j.status === 'queued' && (state.role === 'admin' || state.role === 'analyst');
      return '<tr data-id="' + j.id + '">' +
        '<td><b>' + j.id + '</b><span class="sub">' + j.submittedBy + ', ' + new Date(j.submittedAt).toLocaleTimeString() + '</span></td>' +
        '<td>' + statusPill(j) + '</td>' +
        '<td>' + contractLabel(p) + '<span class="sub">r=' + p.r + ', v=' + p.v + (p.method === 'bs' ? ', Black-Scholes' : '') + '</span></td>' +
        '<td class="num">' + (p.method === 'bs' ? '—' : fmt.int(p.n)) + '</td>' +
        '<td class="num">' + (r ? fmt.p(r.price) : '—') + '</td>' +
        '<td class="num">' + (r ? (r.stderr ? fmt.p(1.96 * r.stderr) : '0') : '—') + '</td>' +
        '<td class="num">' + (r ? fmt.p(r.delta) : '—') + '</td>' +
        '<td class="num">' + (r ? fmt.ms(r.elapsedMs) : '—') + '</td>' +
        '<td>' + (canCancel ? '<button class="btn btn-sm btn-quiet" data-cancel="' + j.id + '">Cancel</button>' : '') + '</td>' +
        '</tr>';
    }).join('');
    $('queueCount').textContent = jobs.filter(function (j) { return j.status === 'queued' || j.status === 'running'; }).length;
  }
  $('jobsBody').addEventListener('click', function (e) {
    var c = e.target.closest('[data-cancel]');
    if (c) {
      e.stopPropagation();
      OE.cancel(c.dataset.cancel).then(function () { toast('Cancelled ' + c.dataset.cancel); refresh(); });
      return;
    }
    var row = e.target.closest('tr[data-id]');
    if (row) openDrawer(row.dataset.id);
  });
  $('refreshBtn').addEventListener('click', refresh);

  function refresh() {
    return OE.list().then(function (jobs) {
      state.jobs = jobs;
      renderQueue();
      if (state.view === 'dash') renderDash();
      if (state.openJob) renderDrawer(state.openJob);
    }).catch(function () { /* keep last good state */ });
  }
  setInterval(refresh, OE.config.pollMs);

  /* ---------- drawer ---------- */
  function openDrawer(id) {
    state.openJob = id;
    renderDrawer(id);
    $('drawer').classList.add('open');
    $('scrim').hidden = false;
  }
  function closeDrawer() {
    state.openJob = null;
    $('drawer').classList.remove('open');
    $('scrim').hidden = true;
  }
  $('drawerClose').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  function renderDrawer(id) {
    var j = state.jobs.find(function (x) { return x.id === id; });
    if (!j) return;
    var p = j.params, r = j.result, html = '';
    html += '<h2>' + j.id + '</h2>';
    html += '<div class="meta">' + contractLabel(p) + ', r=' + p.r + ', v=' + p.v + '. Submitted by ' + j.submittedBy + ' at ' + new Date(j.submittedAt).toLocaleTimeString() + '.</div>';
    html += statusPill(j);
    if (r) {
      var err = Math.abs(r.price - r.reference);
      html += '<div class="price">' + fmt.p(r.price) + '</div>';
      html += '<div class="ci">' + (r.stderr ? '95% interval ' + fmt.p(r.ci95[0]) + ' to ' + fmt.p(r.ci95[1]) + ', standard error ' + fmt.p(r.stderr) : 'Exact, no sampling error') + '</div>';
      html += '<dl>' +
        '<dt>Delta</dt><dd>' + fmt.p(r.delta) + '</dd>' +
        '<dt>Paths</dt><dd>' + (r.paths ? fmt.int(r.paths) : '—') + '</dd>' +
        '<dt>Threads</dt><dd>' + r.threads + '</dd>' +
        '<dt>Run time</dt><dd>' + fmt.ms(r.elapsedMs) + '</dd>' +
        (r.estimatedEngineMs !== undefined ? '<dt>C++ engine, estimated</dt><dd>' + fmt.ms(r.estimatedEngineMs) + '</dd>' : '') +
        '</dl>';
      html += '<div class="vs">Black-Scholes says <b>' + fmt.p(r.reference) + '</b>. This run is off by <b>' + fmt.p(err) + '</b>' +
        (r.stderr ? (err <= 1.96 * r.stderr ? ', inside its own 95% interval.' : ', outside its 95% interval, which happens about 1 run in 20.') : '.') + '</div>';
    } else if (j.status === 'failed') {
      html += '<p style="margin-top:18px;color:var(--paper-2)">' + (j.error || 'The engine did not return a result.') + '</p>';
    } else {
      html += '<p style="margin-top:18px;color:var(--mute)">Waiting on the engine. Estimated ' + fmt.ms(OE.estimateMs(p.n)) + ' once it starts.</p>';
    }
    $('drawerBody').innerHTML = html;
  }

  /* ---------- dashboard ---------- */
  // Typical error (RMSE over 50 seeds) from scripts/convergence.sh, BENCHMARKS.md.
  var BENCH = [ { n: 1e6, err: 0.1084 }, { n: 1e7, err: 0.0379 } ];
  // Official medians, HP Pavilion (i3-6100U, 2 cores / 4 threads), 10M paths,
  // commit 77419a1, before the standard error and delta were added.
  var TIMES = [
    { label: '1 thread', ms: 681.787 },
    { label: '2 threads', ms: 342.396 },
    { label: '4 threads', ms: 234.451 },
    { label: '+ SIMD', ms: null },
    { label: '+ Variance reduction', ms: null }
  ];

  function renderDash() {
    var done = state.jobs.filter(function (j) { return j.status === 'done' && j.params.method === 'mc'; });
    $('kJobs').textContent = fmt.int(done.length);
    $('kPaths').textContent = fmt.int(done.reduce(function (a, j) { return a + j.params.n; }, 0));
    var worst = done.reduce(function (a, j) { return Math.max(a, Math.abs(j.result.price - j.result.reference)); }, 0);
    $('kErr').textContent = done.length ? fmt.p(worst) : '—';
    var mean = done.length ? done.reduce(function (a, j) { return a + j.result.elapsedMs; }, 0) / done.length : null;
    $('kTime').textContent = mean === null ? '—' : fmt.ms(mean);

    drawConvergence(done);
    drawTiming();

    $('recentBody').innerHTML = done.slice(0, 8).map(function (j) {
      return '<tr><td><b>' + j.id + '</b></td><td>' + contractLabel(j.params) + '</td><td class="num">' + fmt.int(j.params.n) + '</td>' +
        '<td class="num">' + fmt.p(j.result.price) + '</td><td class="num">' + fmt.p(j.result.reference) + '</td><td class="num">' + fmt.p(Math.abs(j.result.price - j.result.reference)) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--mute)">No completed Monte Carlo jobs yet.</td></tr>';
  }

  function drawConvergence(done) {
    var svg = $('convChart'), W = 520, H = 260, L = 52, R = 16, Tp = 14, B = 36;
    var live = done.map(function (j) { return { n: j.params.n, err: Math.max(Math.abs(j.result.price - j.result.reference), 1e-5) }; });
    var all = BENCH.concat(live);
    var nMin = 1e4, nMax = 1e8, eMin = 1e-3, eMax = 1;
    all.forEach(function (d) { eMin = Math.min(eMin, d.err); eMax = Math.max(eMax, d.err); });
    eMin = Math.pow(10, Math.floor(Math.log10(eMin))); eMax = Math.pow(10, Math.ceil(Math.log10(eMax)));
    var X = function (n) { return L + (Math.log10(n) - 4) / 4 * (W - L - R); };
    var Y = function (e) { return Tp + (Math.log10(eMax) - Math.log10(e)) / (Math.log10(eMax) - Math.log10(eMin)) * (H - Tp - B); };
    var s = '';
    // gridlines + ticks
    for (var k = 4; k <= 8; k++) {
      s += '<line class="ax" x1="' + X(Math.pow(10, k)) + '" y1="' + Tp + '" x2="' + X(Math.pow(10, k)) + '" y2="' + (H - B) + '" />';
      s += '<text class="tick" x="' + X(Math.pow(10, k)) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + ['10k', '100k', '1M', '10M', '100M'][k - 4] + '</text>';
    }
    for (var e = Math.log10(eMin); e <= Math.log10(eMax); e++) {
      s += '<line class="ax" x1="' + L + '" y1="' + Y(Math.pow(10, e)) + '" x2="' + (W - R) + '" y2="' + Y(Math.pow(10, e)) + '" />';
      s += '<text class="tick" x="' + (L - 6) + '" y="' + (Y(Math.pow(10, e)) + 4) + '" text-anchor="end">' + Math.pow(10, e) + '</text>';
    }
    s += '<text class="lbl" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">paths</text>';
    s += '<text class="lbl" x="' + L + '" y="' + (Tp - 2) + '">error</text>';
    // expected 95% error for the reference contract: 1.96 x sd / sqrt(n), sd ~ 108
    var c = 1.96 * 108;
    s += '<path class="ln ref" d="M' + X(nMin) + ' ' + Y(Math.min(eMax, c / Math.sqrt(nMin))) + ' L' + X(nMax) + ' ' + Y(Math.max(eMin, c / Math.sqrt(nMax))) + '" />';
    // measured C++ points, joined
    s += '<path class="ln" d="' + BENCH.map(function (d, i) { return (i ? 'L' : 'M') + X(d.n) + ' ' + Y(d.err); }).join(' ') + '" />';
    BENCH.forEach(function (d) { s += '<circle class="pt" cx="' + X(d.n) + '" cy="' + Y(d.err) + '" r="5" />'; });
    live.forEach(function (d) {
      if (d.n >= nMin && d.n <= nMax) s += '<circle class="pt live" cx="' + X(d.n) + '" cy="' + Y(Math.min(Math.max(d.err, eMin), eMax)) + '" r="3.5" />';
    });
    svg.innerHTML = s;
  }

  function drawTiming() {
    var svg = $('timeChart'), W = 520, H = 260, L = 150, R = 60, Tp = 16, rowH = (H - Tp - 10) / TIMES.length;
    var max = 900, s = '';
    TIMES.forEach(function (t, i) {
      var y = Tp + i * rowH, h = rowH * 0.58;
      var w = t.ms ? (t.ms / max) * (W - L - R) : 0;
      s += '<text class="lbl" x="' + (L - 10) + '" y="' + (y + h / 2 + 4) + '" text-anchor="end">' + t.label + '</text>';
      if (t.ms) {
        s += '<rect class="bar sig" x="' + L + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2" />';
        s += '<text class="bar-lbl" x="' + (L + w + 8) + '" y="' + (y + h / 2 + 4) + '">' + Math.round(t.ms) + ' ms</text>';
      } else {
        s += '<rect x="' + L + '" y="' + y + '" width="' + (W - L - R) + '" height="' + h + '" rx="2" fill="none" stroke="var(--line)" stroke-dasharray="4 4" />';
        s += '<text class="tick" x="' + (L + 10) + '" y="' + (y + h / 2 + 4) + '">not measured yet</text>';
      }
    });
    svg.innerHTML = s;
  }

  /* ---------- admin ---------- */
  $('adSave').addEventListener('click', function () {
    var th = parseInt($('adThreads').value, 10), mx = parseInt($('adMax').value, 10), ns = parseFloat($('adNs').value);
    if (!(th >= 1) || !(mx >= 1000) || !(ns > 0)) { toast('Check the engine settings'); return; }
    OE.config.engine.threads = th; OE.config.engine.maxPaths = mx; OE.config.engine.nsPerPath = ns;
    $('engineText').textContent = (OE.isMock() ? 'Browser engine, ' : 'Engine online, ') + th + ' threads';
    renderPreview();
    toast('Engine settings saved');
  });
  $('adClear').addEventListener('click', function () {
    var q = state.jobs.filter(function (j) { return j.status === 'queued'; });
    Promise.all(q.map(function (j) { return OE.cancel(j.id); })).then(function () {
      toast(q.length ? 'Cancelled ' + q.length + ' queued job' + (q.length === 1 ? '' : 's') : 'Nothing queued');
      refresh();
    });
  });

  /* ---------- go ---------- */
  applyRole('analyst');
  renderPreview();
  refresh();
})();
