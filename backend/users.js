/* Accounts for the platform: who can sign in, and with which role.

   Roles (the same three the frontend has):
     analyst  price options, see and cancel jobs
     risk     see jobs and the dashboard (read only)
     admin    everything, plus the admin page (engine settings, users)

   Passwords are never stored. Each account keeps a random "salt" and the
   scrypt hash of salt + password; signing in hashes what was typed the same
   way and compares. scrypt is deliberately slow, which makes guessing
   passwords from a stolen users.json expensive.

   Team accounts ("seed" accounts):
     backend/seed-users.json is tracked in git and holds the team's accounts
     as username, display name, role, salt and hash only, never a password.
     A hash is a one-way fingerprint: it can check a typed password but
     cannot be turned back into one, so it is safe to share. On every start
     the server copies any seed account that is missing from this machine's
     data/users.json; accounts already there are never changed or removed.
     The passwords themselves are sent to each person privately.

   Command line (run from the project folder):
     node backend/users.js list
     node backend/users.js add <username> <role> <password> [display name]
     node backend/users.js remove <username>
     node backend/users.js seed      new passwords for all team accounts:
                                     rewrites backend/seed-users.json and
                                     writes data/team-passwords.txt
*/

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const ROLES = ['analyst', 'risk', 'admin'];
const FILE = 'users.json';
const SEED_FILE = path.join(__dirname, 'seed-users.json');

// The team: one account per person per role, e.g. utpal.analyst.
const TEAM = [
    { id: 'utpal', name: 'Utpal' },
    { id: 'harsh', name: 'Harsh' },
    { id: 'aryan', name: 'Aryan' },
    { id: 'arya',  name: 'Arya' }
];
const ROLE_LABEL = { analyst: 'Analyst', risk: 'Risk Manager', admin: 'Admin' };

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function loadUsers() {
    return store.readJson(FILE, []);
}

function checkNewUser(username, role, password) {
    if (!/^[a-z0-9._-]{2,32}$/i.test(username || '')) return 'username: 2-32 letters, digits, . _ -';
    if (ROLES.indexOf(role) < 0) return 'role must be one of: ' + ROLES.join(', ');
    if (typeof password !== 'string' || password.length < 6) return 'password must be at least 6 characters';
    return null;
}

// Builds one stored account: a fresh random salt and the hash of
// salt + password. The password itself is not kept.
function makeAccount(username, role, password, name) {
    const problem = checkNewUser(username, role, password);
    if (problem) throw new Error(problem);
    const salt = crypto.randomBytes(16).toString('hex');
    return { username: username, name: name || username, role: role,
             salt: salt, hash: hashPassword(password, salt) };
}

// Adds an account, or replaces it if the username already exists.
function addUser(username, role, password, name) {
    const account = makeAccount(username, role, password, name);
    const users = loadUsers().filter(function (u) { return u.username !== username; });
    users.push(account);
    store.writeJson(FILE, users);
}

// The team accounts from backend/seed-users.json ([] if the file is missing).
function loadSeedUsers() {
    try {
        return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw new Error(SEED_FILE + ' is not valid JSON: ' + e.message);
    }
}

// Server start: copy every seed account that this machine does not have yet.
// Matching is by username. Existing accounts are never overwritten or
// deleted, so a password someone changed locally stays changed.
// Returns the usernames that were added.
function mergeSeedUsers() {
    const users = loadUsers();
    const have = new Set(users.map(function (u) { return u.username; }));
    const added = [];
    loadSeedUsers().forEach(function (s) {
        if (have.has(s.username)) return;
        if (ROLES.indexOf(s.role) < 0 || !s.salt || !s.hash) return;   // skip damaged entries
        users.push({ username: s.username, name: s.name, role: s.role, salt: s.salt, hash: s.hash });
        have.add(s.username);
        added.push(s.username);
    });
    if (added.length) store.writeJson(FILE, users);
    return added;
}

// `node backend/users.js seed`: new random passwords for all 12 team
// accounts. The hashes go to backend/seed-users.json (committed); the
// passwords go to data/team-passwords.txt (never committed), to be sent to
// each person privately. Running it again replaces everything.
function writeSeed() {
    const accounts = [];
    const lines = [];
    TEAM.forEach(function (person) {
        ROLES.forEach(function (role) {
            const username = person.id + '.' + role;
            // 9 random bytes = 72 bits, written as 12 letters/digits/-/_.
            // Far too many possibilities to guess from the hash.
            const password = crypto.randomBytes(9).toString('base64url');
            accounts.push(makeAccount(username, role, password, person.name + ' (' + ROLE_LABEL[role] + ')'));
            lines.push(username.padEnd(16) + password);
        });
    });
    const tmp = SEED_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 1) + '\n');
    fs.renameSync(tmp, SEED_FILE);

    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    const passFile = store.file('team-passwords.txt');
    fs.writeFileSync(passFile,
        'Team account passwords (username, password). Generated ' + new Date().toISOString() + '.\n' +
        'Send each person their three lines privately. This file is not in git.\n\n' +
        lines.join('\n') + '\n', { mode: 0o600 });   // readable by this user only
    return { count: accounts.length, seedFile: SEED_FILE, passFile: passFile };
}

function removeUser(username) {
    const users = loadUsers();
    const left = users.filter(function (u) { return u.username !== username; });
    store.writeJson(FILE, left);
    return left.length < users.length;
}

// Returns {username, name, role} if the password is right, otherwise null.
function verify(username, password) {
    const user = loadUsers().find(function (u) { return u.username === username; });
    if (!user || typeof password !== 'string') return null;
    const tried = Buffer.from(hashPassword(password, user.salt), 'hex');
    const stored = Buffer.from(user.hash, 'hex');
    // timingSafeEqual takes the same time whether the first or last byte
    // differs, so the response time leaks nothing about the password.
    if (tried.length !== stored.length || !crypto.timingSafeEqual(tried, stored)) return null;
    return { username: user.username, name: user.name, role: user.role };
}

function listUsers() {
    return loadUsers().map(function (u) { return { username: u.username, name: u.name, role: u.role }; });
}

// Fallback for a copy with no team accounts at all (no seed file) and no
// local accounts: create one per role with a random password, and save the
// passwords where only this machine can read them.
function ensureDemoUsers() {
    if (loadSeedUsers().length > 0 || loadUsers().length > 0) return null;
    const lines = [];
    ROLES.forEach(function (role) {
        const password = crypto.randomBytes(6).toString('base64url');
        addUser(role, role, password, 'Demo ' + role);
        lines.push(role + '  ' + password);
    });
    const text = 'Demo accounts created on first start (username  password).\n' +
                 'Change or remove them with: node backend/users.js\n\n' + lines.join('\n') + '\n';
    require('fs').writeFileSync(store.file('demo-passwords.txt'), text);
    return store.file('demo-passwords.txt');
}

module.exports = { ROLES, addUser, removeUser, verify, listUsers, ensureDemoUsers, mergeSeedUsers };


/* ---------- command line ---------- */

if (require.main === module) {
    const [command, username, role, password, ...nameParts] = process.argv.slice(2);
    try {
        if (command === 'list') {
            const users = listUsers();
            if (!users.length) console.log('no users yet (the server creates demo accounts on first start)');
            users.forEach(function (u) { console.log(u.username.padEnd(16) + u.role.padEnd(10) + u.name); });
        } else if (command === 'add') {
            addUser(username, role, password, nameParts.join(' '));
            console.log('saved ' + username + ' (' + role + ')');
        } else if (command === 'remove') {
            console.log(removeUser(username) ? 'removed ' + username : 'no user ' + username);
        } else if (command === 'seed') {
            const r = writeSeed();
            console.log('wrote ' + r.count + ' team accounts (hashes only) to ' + r.seedFile);
            console.log('passwords are in ' + r.passFile + ' (not in git); send them privately');
            console.log('every copy picks up missing team accounts the next time its server starts');
        } else {
            console.log('usage:\n  node backend/users.js list\n' +
                        '  node backend/users.js add <username> <role> <password> [display name]\n' +
                        '  node backend/users.js remove <username>\n' +
                        '  node backend/users.js seed     (new passwords for all team accounts)\n' +
                        'roles: ' + ROLES.join(', '));
            process.exitCode = 1;
        }
    } catch (e) {
        console.error('error: ' + e.message);
        process.exitCode = 1;
    }
}
