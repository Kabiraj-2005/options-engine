/* Landing page: the hero draws real geometric-Brownian-motion price paths
   for the reference contract and runs a small Monte Carlo estimate live,
   so the first thing on screen is the thing the engine actually does. */

(function () {
  // Mobile nav
  var btn = document.getElementById('menuBtn');
  var nav = document.getElementById('nav');
  if (btn) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  var canvas = document.getElementById('paths');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reference contract
  var S = 1400, K = 1500, T = 0.25, r = 0.06, v = 0.30;
  var STEPS = 64, N = 140;              // paths drawn on screen
  var EST_PATHS = 200000;               // paths used for the live estimate

  function gauss() {
    var u = 1 - Math.random(), w = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  // One full price path, STEPS points, exact GBM step
  function makePath() {
    var dt = T / STEPS, p = [S], x = S;
    var drift = (r - 0.5 * v * v) * dt, vol = v * Math.sqrt(dt);
    for (var i = 0; i < STEPS; i++) { x = x * Math.exp(drift + vol * gauss()); p.push(x); }
    return p;
  }

  var paths = [];
  for (var i = 0; i < N; i++) paths.push(makePath());

  // Layout
  var W, H, dpr, lo = 900, hi = 2000;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(progress);
  }
  function X(i) { return (i / STEPS) * W * 1.04 - W * 0.02; }
  function Y(price) { return H - ((price - lo) / (hi - lo)) * H; }

  var progress = reduce ? 1 : 0;   // 0..1 how much of each path is drawn

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var upto = Math.max(1, Math.floor(t * STEPS));

    // strike line
    ctx.strokeStyle = 'rgba(243,238,230,0.10)';
    ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(0, Y(K)); ctx.lineTo(W, Y(K)); ctx.stroke();
    ctx.setLineDash([]);

    var dim = W < 700 ? 0.5 : 1;   // paths sit behind the headline on phones
    for (var p = 0; p < paths.length; p++) {
      var path = paths[p];
      var itm = path[STEPS] > K;   // finishes in the money
      ctx.strokeStyle = itm ? 'rgba(242,107,44,' + (0.42 * dim) + ')' : 'rgba(203,196,186,' + (0.10 * dim) + ')';
      ctx.lineWidth = itm ? 1.1 : 0.9;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(path[0]));
      for (var i = 1; i <= upto; i++) ctx.lineTo(X(i), Y(path[i]));
      ctx.stroke();
    }

    // strike label
    ctx.fillStyle = 'rgba(143,136,128,0.9)';
    ctx.font = '500 12px "Bricolage Grotesque", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('strike 1500', W - 18, Y(K) - 6);
  }

  // Live estimate: proper terminal-price Monte Carlo in chunks so the
  // readout counts up while the paths draw.
  var roPaths = document.getElementById('roPaths');
  var roPrice = document.getElementById('roPrice');
  var done = 0, sum = 0, disc = Math.exp(-r * T);
  var drift = (r - 0.5 * v * v) * T, vol = v * Math.sqrt(T);

  function chunk(n) {
    for (var i = 0; i < n; i++) {
      var st = S * Math.exp(drift + vol * gauss());
      sum += Math.max(st - K, 0);
    }
    done += n;
    roPaths.textContent = done.toLocaleString('en-US');
    roPrice.textContent = (disc * sum / done).toFixed(4);
  }

  var start = null, DUR = 1800;
  function frame(ts) {
    if (!start) start = ts;
    var t = Math.min(1, (ts - start) / DUR);
    var eased = 1 - Math.pow(1 - t, 3);
    progress = eased;
    draw(progress);
    var target = Math.floor(eased * EST_PATHS);
    if (target > done) chunk(target - done);
    if (t < 1) requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  if (reduce) { chunk(EST_PATHS); }
  else { requestAnimationFrame(frame); }
})();
