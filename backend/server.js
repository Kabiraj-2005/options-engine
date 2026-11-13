/* options-engine backend.

   A small web server (Node.js, built-in modules only, nothing to install)
   that sits between the website and the C++ engine:

     website  --HTTP-->  this server  --runs-->  ./pricer ... --json
     website  <--JSON--  this server  <--prints-- one JSON line

   It keeps a queue of pricing jobs and runs them ONE AT A TIME, because each
   job already uses every CPU thread; running several at once would only make
   all of them slower and their timings meaningless.

   Endpoints:
     GET    /health           is the server up? (no sign-in needed)
     POST   /login            body {username, password} -> {token, user}
     POST   /logout
     GET    /me               who is signed in
     POST   /jobs             body {params} -> new job        (analyst, admin)
     GET    /jobs             all jobs, newest first          (any role)
     GET    /jobs/:id         one job                         (any role)
     DELETE /jobs/:id         cancel a queued or running job  (analyst, admin)
     GET    /admin/settings   engine settings                 (admin)
     PUT    /admin/settings   body {threads, maxPaths}        (admin)
     GET    /admin/users      accounts, without passwords     (admin)
   Every request except /health and /login needs the header
     Authorization: Bearer <token>
   Any other GET serves the frontend files, so the whole platform is at
   http://localhost:10241/ and http://localhost:10241/app.html

   Job history, settings and accounts are saved in data/ (see store.js), so
   they survive a restart. Accounts: see users.js.

   Run from the project folder:
     g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
     node backend/server.js
*/

const http = require('http');                  // web server
const fs = require('fs');                      // reading the frontend files
const path = require('path');                  // building file paths safely
const crypto = require('crypto');              // random sign-in tokens
const { execFile } = require('child_process'); // running the C++ engine
const store = require('./store');
const users = require('./users');

const PORT = Number(process.env.PORT) || 10241;     // 10241: from roll number 1024170034
const MIN_PATHS = 1000;
const ENGINE_TIMEOUT_MS = 10 * 60 * 1000;           // give up on a run after 10 minutes
const MAX_JOBS_KEPT = 500;                          // oldest finished jobs are dropped after this
const MAX_BODY_BYTES = 10 * 1024;
const SESSION_HOURS = 12;

const PRICER = path.join(__dirname, '..', 'pricer');     // the compiled engine
const FRONTEND = path.join(__dirname, '..', 'frontend'); // the website files


/* ---------- settings (changed on the admin page, saved to disk) ---------- */

const settings = Object.assign({ threads: 4, maxPaths: 100000000 },   // Pavilion: 2 cores, 4 threads
                               store.readJson('settings.json', {}));
if (process.env.THREADS) settings.threads = Number(process.env.THREADS);

function checkSettings(s) {
    if (!Number.isInteger(s.threads) || s.threads < 1 || s.threads > 64) return 'threads must be a whole number from 1 to 64';
    if (!Number.isInteger(s.maxPaths) || s.maxPaths < MIN_PATHS || s.maxPaths > 1000000000) {
        return 'maxPaths must be a whole number from ' + MIN_PATHS + ' to 1000000000';
    }
    return null;
}


/* ---------- the engine ---------- */

// Runs the engine once and hands the parsed JSON result to `done`.
// The arguments go in as a LIST, never as one command string, so nothing the
// user types can ever be run by the shell (no command injection).
// Returns the running process, so a job can be cancelled while it runs.
function runPricer(args, done) {
    return execFile(PRICER, args, { timeout: ENGINE_TIMEOUT_MS }, function (error, stdout, stderr) {
        if (error) {
            const why = error.killed ? 'engine stopped (cancelled or timed out)'
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
    if (p.method === 'mc' && (!Number.isInteger(p.n) || p.n < MIN_PATHS || p.n > settings.maxPaths)) {
        return 'n must be a whole number from ' + MIN_PATHS + ' to ' + settings.maxPaths;
    }
    return null;
}

// Turns checked params into the engine's command-line arguments.
// Each job gets its own seed (its job number), so repeating a contract gives
// a fresh, independent run rather than the same numbers again.
function toArgs(p, seed, threads) {
    const args = [String(threads), p.method === 'bs' ? '--exact' : '--json',
                  '--S', String(p.S), '--K', String(p.K), '--T', String(p.T),
                  '--r', String(p.r), '--v', String(p.v)];
    if (p.method === 'mc') args.push('--paths', String(p.n), '--seed', String(seed));
    if (p.type === 'put') args.push('--put');
    return args;
}


/* ---------- the job queue (saved to data/jobs.json) ---------- */

const jobs = store.readJson('jobs.json', []);      // newest first, like the frontend shows them

// Job numbers carry on from the saved history (J-0001, J-0002, ...), so ids
// and seeds are never reused after a restart.
let nextNumber = 1 + jobs.reduce(function (most, j) {
    return Math.max(most, Number(j.id.slice(2)) || 0);
}, 0);

// A job that was running when the server stopped did not finish.
jobs.forEach(function (j) {
    if (j.status === 'running') {
        j.status = 'failed';
        j.error = 'Server stopped while this job was running';
        j.finishedAt = new Date().toISOString();
    }
});

let running = null;   // {job, child} while the engine is busy, otherwise null

function saveJobs() {
    try { store.writeJson('jobs.json', jobs); }
    catch (e) { console.error('could not save jobs:', e.message); }
}

function createJob(params, user) {
    const number = nextNumber++;
    const job = {
        id: 'J-' + String(number).padStart(4, '0'),
        status: 'queued',
        submittedAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        submittedBy: user.name,
        submittedByUser: user.username,
        params: { type: params.type, method: params.method, S: params.S, K: params.K,
                  T: params.T, r: params.r, v: params.v, n: params.n },
        seed: params.method === 'mc' ? number : null,
        threads: settings.threads,
        result: null,
        error: null
    };
    jobs.unshift(job);
    dropOldJobs();
    saveJobs();
    return job;
}

// Keeps the history bounded: removes the oldest finished jobs beyond MAX_JOBS_KEPT.
function dropOldJobs() {
    for (let i = jobs.length - 1; jobs.length > MAX_JOBS_KEPT && i >= 0; i--) {
        if (jobs[i].status === 'done' || jobs[i].status === 'failed') jobs.splice(i, 1);
    }
}

// Starts the oldest queued job if the engine is free. Called whenever a job is
// added and whenever one finishes, so the queue keeps moving by itself.
function runNext() {
    if (running) return;
    let job = null;
    for (let i = jobs.length - 1; i >= 0; i--) {          // oldest is at the end
        if (jobs[i].status === 'queued') { job = jobs[i]; break; }
    }
    if (!job) return;

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.threads = settings.threads;
    saveJobs();
    const args = toArgs(job.params, job.seed, job.threads);
    console.log(job.id + ' running: ./pricer ' + args.join(' '));

    const child = runPricer(args, function (err, result) {
        job.finishedAt = new Date().toISOString();
        if (running && running.cancelled) {
            job.status = 'failed';
            job.error = 'Cancelled';
        } else if (err) {
            job.status = 'failed';
            job.error = err.message;
        } else {
            job.status = 'done';
            job.result = result;
        }
        console.log(job.id + ' ' + job.status + (job.error ? ': ' + job.error : ''));
        running = null;
        saveJobs();
        runNext();
    });
    running = { job: job, child: child, cancelled: false };
}

function findJob(id) {
    return jobs.find(function (j) { return j.id === id; });
}

function cancelJob(job) {
    if (job.status === 'queued') {
        job.status = 'failed';
        job.error = 'Cancelled';
        job.finishedAt = new Date().toISOString();
        saveJobs();
        return true;
    }
    if (job.status === 'running' && running && running.job === job) {
        running.cancelled = true;
        running.child.kill();          // the engine stops; runPricer's callback marks the job
        return true;
    }
    return false;                      // already done or failed
}


/* ---------- sign-in ---------- */

// token -> {username, name, role, expires}. Kept in memory: after a server
// restart everyone simply signs in again.
const sessions = new Map();

function startSession(user) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Object.assign({ expires: Date.now() + SESSION_HOURS * 3600 * 1000 }, user));
    return token;
}

// Returns the signed-in user for this request, or null.
function whoIs(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) { sessions.delete(token); return null; }
    return session;
}


/* ---------- HTTP helpers ---------- */

// The CORS headers let a copy of the frontend opened from somewhere else
// (another port, or a file) still talk to this server.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
    const isApi = pathname === '/me' || pathname === '/logout' || pathname === '/jobs' ||
                  jobMatch || pathname.startsWith('/admin/');

    if (req.method === 'OPTIONS') {                       // browser's CORS pre-check
        sendJson(res, 204);
        return;
    }
    if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true, mode: 'C++ engine', threads: settings.threads,
                             maxPaths: settings.maxPaths, engineBuilt: fs.existsSync(PRICER),
                             busy: running !== null, signInRequired: true });
        return;
    }
    if (req.method === 'POST' && pathname === '/login') {
        readJsonBody(req, function (err, body) {
            const user = !err && body ? users.verify(String(body.username || ''), body.password) : null;
            if (!user) {
                // a short pause makes guessing many passwords slow
                setTimeout(function () { sendJson(res, 401, { error: 'Wrong username or password' }); }, 400);
                return;
            }
            sendJson(res, 200, { token: startSession(user), user: user });
        });
        return;
    }
    if (!isApi) {
        if (req.method === 'GET') serveFrontend(pathname, res);
        else sendJson(res, 404, { error: 'Not Found' });
        return;
    }

    // Everything below needs a signed-in user.
    const user = whoIs(req);
    if (!user) { sendJson(res, 401, { error: 'Please sign in' }); return; }
    const can = function (roles) {
        if (roles.indexOf(user.role) >= 0) return true;
        sendJson(res, 403, { error: 'Your role (' + user.role + ') cannot do this' });
        return false;
    };

    if (req.method === 'GET' && pathname === '/me') {
        sendJson(res, 200, { username: user.username, name: user.name, role: user.role });

    } else if (req.method === 'POST' && pathname === '/logout') {
        sessions.delete((req.headers.authorization || '').slice(7));
        sendJson(res, 204);

    } else if (req.method === 'GET' && pathname === '/jobs') {
        sendJson(res, 200, jobs);

    } else if (req.method === 'POST' && pathname === '/jobs') {
        if (!can(['analyst', 'admin'])) return;
        readJsonBody(req, function (err, body) {
            if (err) { sendJson(res, 400, { error: err.message }); return; }
            const problem = checkParams(body && body.params);
            if (problem) { sendJson(res, 400, { error: problem }); return; }
            const job = createJob(body.params, user);
            sendJson(res, 201, job);
            runNext();
        });

    } else if (req.method === 'GET' && jobMatch) {
        const job = findJob(jobMatch[1]);
        if (job) sendJson(res, 200, job); else sendJson(res, 404, { error: 'No job ' + jobMatch[1] });

    } else if (req.method === 'DELETE' && jobMatch) {
        if (!can(['analyst', 'admin'])) return;
        const job = findJob(jobMatch[1]);
        if (!job) { sendJson(res, 404, { error: 'No job ' + jobMatch[1] }); return; }
        if (!cancelJob(job)) { sendJson(res, 409, { error: 'Job ' + job.id + ' has already finished' }); return; }
        sendJson(res, 204);

    } else if (req.method === 'GET' && pathname === '/admin/settings') {
        if (!can(['admin'])) return;
        sendJson(res, 200, settings);

    } else if (req.method === 'PUT' && pathname === '/admin/settings') {
        if (!can(['admin'])) return;
        readJsonBody(req, function (err, body) {
            if (err) { sendJson(res, 400, { error: err.message }); return; }
            const next = { threads: body && body.threads, maxPaths: body && body.maxPaths };
            const problem = checkSettings(next);
            if (problem) { sendJson(res, 400, { error: problem }); return; }
            Object.assign(settings, next);
            store.writeJson('settings.json', settings);
            console.log('settings changed by ' + user.username + ': ' + JSON.stringify(settings));
            sendJson(res, 200, settings);
        });

    } else if (req.method === 'GET' && pathname === '/admin/users') {
        if (!can(['admin'])) return;
        sendJson(res, 200, users.listUsers());

    } else {
        sendJson(res, 404, { error: 'Not Found' });
    }
}

// Ctrl+C (or a system shutdown): stop the engine if it is running, so no
// pricer process is left behind, then exit. The interrupted job is marked
// as failed when the server next starts.
function shutDown() {
    if (running) running.child.kill();
    saveJobs();
    console.log('\nbackend stopped');
    process.exit(0);
}
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);

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
    console.log('data folder: ' + store.DATA_DIR + '  (' + jobs.length + ' saved jobs, engine threads: ' + settings.threads + ')');
    const created = users.ensureDemoUsers();
    if (created) console.log('first start: created demo accounts analyst / risk / admin; passwords are in ' + created);
    if (!fs.existsSync(PRICER)) {
        console.log('warning: engine not built yet. Run: g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer');
    }
    runNext();   // carry on with any jobs still queued from before the restart
});
