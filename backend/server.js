/* options-engine backend.

   A small web server (Node.js, built-in modules only, nothing to install)
   that sits between the website and the C++ engine:

     website  --HTTP-->  this server  --runs-->  ./pricer ... --json
     website  <--JSON--  this server  <--prints-- one JSON line

   It keeps a queue of pricing jobs and runs them ONE AT A TIME, because each
   job already uses every CPU thread; running several at once would only make
   all of them slower and their timings meaningless.

   Endpoints (the contract in frontend/js/api.js):
     GET    /health      is the server up?
     POST   /jobs        body {params, submittedBy} -> new job (status "queued")
     GET    /jobs        all jobs, newest first
     GET    /jobs/:id    one job
     DELETE /jobs/:id    cancel a job that is still queued
   Any other GET serves the frontend files, so the whole platform is at
   http://localhost:10241/ and http://localhost:10241/app.html

   Run from the project folder:
     g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
     node backend/server.js
*/

const http = require('http');                 // web server
const fs = require('fs');                     // reading the frontend files
const path = require('path');                 // building file paths safely
const { execFile } = require('child_process'); // running the C++ engine

const PORT = Number(process.env.PORT) || 10241;     // 10241: from roll number 1024170034
const THREADS = Number(process.env.THREADS) || 4;   // Pavilion: 2 cores, 4 threads
const MIN_PATHS = 1000;
const MAX_PATHS = 100000000;
const ENGINE_TIMEOUT_MS = 10 * 60 * 1000;           // give up on a run after 10 minutes
const MAX_JOBS_KEPT = 500;                          // oldest finished jobs are dropped after this
const MAX_BODY_BYTES = 10 * 1024;

const PRICER = path.join(__dirname, '..', 'pricer');     // the compiled engine
const FRONTEND = path.join(__dirname, '..', 'frontend'); // the website files


/* ---------- the engine ---------- */

// Runs the engine once and hands the parsed JSON result to `done`.
// The arguments go in as a LIST, never as one command string, so nothing the
// user types can ever be run by the shell (no command injection).
function runPricer(args, done) {
    execFile(PRICER, args, { timeout: ENGINE_TIMEOUT_MS }, function (error, stdout, stderr) {
        if (error) {
            const why = error.killed ? 'engine timed out'
                      : error.code === 'ENOENT' ? 'engine not built (run g++ ... -o pricer)'
                      : 'engine failed: ' + (stderr.split('\n')[0] || error.message);
            done(new Error(why));
            return;
        }
        let result;
        try {
            result = JSON.parse(stdout);
        } catch (e) {
            done(new Error('engine output was not JSON'));
            return;
        }
        done(null, result);
    });
}

// Checks the params sent by the website. Returns an error message, or null if
// they are fine. The engine checks them again, but a clear message here is
// friendlier than a failed job.
function checkParams(p) {
    const isNum = function (x) { return typeof x === 'number' && Number.isFinite(x); };
    if (!p || typeof p !== 'object') return 'params missing';
    if (p.type !== 'call' && p.type !== 'put') return 'type must be "call" or "put"';
    if (p.method !== 'mc' && p.method !== 'bs') return 'method must be "mc" or "bs"';
    if (!isNum(p.S) || p.S <= 0) return 'S must be a number above 0';
    if (!isNum(p.K) || p.K <= 0) return 'K must be a number above 0';
    if (!isNum(p.T) || p.T <= 0) return 'T must be a number above 0';
    if (!isNum(p.r)) return 'r must be a number';
    if (!isNum(p.v) || p.v <= 0) return 'v must be a number above 0';
    if (p.method === 'mc' && (!Number.isInteger(p.n) || p.n < MIN_PATHS || p.n > MAX_PATHS)) {
        return 'n must be a whole number from ' + MIN_PATHS + ' to ' + MAX_PATHS;
    }
    return null;
}

// Turns checked params into the engine's command-line arguments.
// Each job gets its own seed (its job number), so repeating a contract gives
// a fresh, independent run rather than the same numbers again.
function toArgs(p, seed) {
    const args = [String(THREADS), p.method === 'bs' ? '--exact' : '--json',
                  '--S', String(p.S), '--K', String(p.K), '--T', String(p.T),
                  '--r', String(p.r), '--v', String(p.v)];
    if (p.method === 'mc') args.push('--paths', String(p.n), '--seed', String(seed));
    if (p.type === 'put') args.push('--put');
    return args;
}


/* ---------- the job queue ---------- */

const jobs = [];      // newest first, like the frontend shows them
let nextNumber = 1;
let busy = false;     // is the engine running a job right now?

function createJob(params, submittedBy) {
    const number = nextNumber++;
    const job = {
        id: 'J-' + String(number).padStart(4, '0'),
        status: 'queued',
        submittedAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        submittedBy: typeof submittedBy === 'string' && submittedBy ? submittedBy.slice(0, 40) : 'unknown',
        params: { type: params.type, method: params.method, S: params.S, K: params.K,
                  T: params.T, r: params.r, v: params.v, n: params.n },
        seed: params.method === 'mc' ? number : null,
        result: null,
        error: null
    };
    jobs.unshift(job);
    dropOldJobs();
    return job;
}

// Keeps memory bounded: removes the oldest finished jobs beyond MAX_JOBS_KEPT.
function dropOldJobs() {
    for (let i = jobs.length - 1; jobs.length > MAX_JOBS_KEPT && i >= 0; i--) {
        if (jobs[i].status === 'done' || jobs[i].status === 'failed') jobs.splice(i, 1);
    }
}

// Starts the oldest queued job if the engine is free. Called whenever a job is
// added and whenever one finishes, so the queue keeps moving by itself.
function runNext() {
    if (busy) return;
    let job = null;
    for (let i = jobs.length - 1; i >= 0; i--) {          // oldest is at the end
        if (jobs[i].status === 'queued') { job = jobs[i]; break; }
    }
    if (!job) return;

    busy = true;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    console.log(job.id + ' running: ./pricer ' + toArgs(job.params, job.seed).join(' '));

    runPricer(toArgs(job.params, job.seed), function (err, result) {
        job.finishedAt = new Date().toISOString();
        if (err) {
            job.status = 'failed';
            job.error = err.message;
        } else {
            job.status = 'done';
            job.result = result;
        }
        console.log(job.id + ' ' + job.status + (err ? ': ' + err.message : ''));
        busy = false;
        runNext();
    });
}

function findJob(id) {
    return jobs.find(function (j) { return j.id === id; });
}


/* ---------- HTTP helpers ---------- */

// The CORS headers let a copy of the frontend opened from somewhere else
// (another port, or a file) still talk to this server.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

function sendJson(res, status, body) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, CORS));
    res.end(body === undefined ? '' : JSON.stringify(body));
}

// Collects the request body (it arrives in pieces) and parses it as JSON.
function readJsonBody(req, done) {
    let text = '';
    let tooBig = false;
    req.on('data', function (piece) {
        if (tooBig) return;                       // stop collecting, but let it finish
        text += piece;
        if (text.length > MAX_BODY_BYTES) tooBig = true;
    });
    req.on('end', function () {
        if (tooBig) { done(new Error('body too large')); return; }
        try { done(null, JSON.parse(text)); }
        catch (e) { done(new Error('body is not valid JSON')); }
    });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Serves a file from the frontend folder, and nothing outside it.
function serveFrontend(pathname, res) {
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(FRONTEND, path.normalize(pathname));
    if (!file.startsWith(FRONTEND + path.sep)) { sendJson(res, 404, { error: 'Not Found' }); return; }
    fs.readFile(file, function (err, data) {
        if (err) { sendJson(res, 404, { error: 'Not Found' }); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
}


/* ---------- routes ---------- */

// This function is the doorbell: Node calls it for EVERY request.
// req = the request (what they asked for), res = the response (what you send back)
function handle(req, res) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (e) { sendJson(res, 400, { error: 'bad URL' }); return; }
    const jobMatch = pathname.match(/^\/jobs\/([A-Za-z0-9-]+)$/);

    if (req.method === 'OPTIONS') {                       // browser's CORS pre-check
        sendJson(res, 204);

    } else if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true, mode: 'C++ engine', threads: THREADS,
                             engineBuilt: fs.existsSync(PRICER), busy: busy });

    } else if (req.method === 'GET' && pathname === '/jobs') {
        sendJson(res, 200, jobs);

    } else if (req.method === 'POST' && pathname === '/jobs') {
        readJsonBody(req, function (err, body) {
            if (err) { sendJson(res, 400, { error: err.message }); return; }
            const problem = checkParams(body && body.params);
            if (problem) { sendJson(res, 400, { error: problem }); return; }
            const job = createJob(body.params, body.submittedBy);
            sendJson(res, 201, job);
            runNext();
        });

    } else if (req.method === 'GET' && jobMatch) {
        const job = findJob(jobMatch[1]);
        if (job) sendJson(res, 200, job); else sendJson(res, 404, { error: 'No job ' + jobMatch[1] });

    } else if (req.method === 'DELETE' && jobMatch) {
        const job = findJob(jobMatch[1]);
        if (!job) { sendJson(res, 404, { error: 'No job ' + jobMatch[1] }); return; }
        if (job.status !== 'queued') { sendJson(res, 409, { error: 'Only queued jobs can be cancelled' }); return; }
        job.status = 'failed';
        job.error = 'Cancelled';
        job.finishedAt = new Date().toISOString();
        sendJson(res, 204);

    } else if (req.method === 'GET') {
        serveFrontend(pathname, res);

    } else {
        sendJson(res, 404, { error: 'Not Found' });
    }
}

const server = http.createServer(function (req, res) {
    // One bad request must never take the whole server down.
    try { handle(req, res); }
    catch (e) {
        console.error('request failed:', e);
        if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
    }
});

server.listen(PORT, function () {
    console.log('backend listening on http://localhost:' + PORT + '  (platform: http://localhost:' + PORT + '/app.html)');
    if (!fs.existsSync(PRICER)) {
        console.log('warning: engine not built yet. Run: g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer');
    }
});
