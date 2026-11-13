/* Accounts for the platform: who can sign in, and with which role.

   Roles (the same three the frontend has):
     analyst  price options, see and cancel jobs
     risk     see jobs and the dashboard (read only)
     admin    everything, plus the admin page (engine settings, users)

   Passwords are never stored. Each account keeps a random "salt" and the
   scrypt hash of salt + password; signing in hashes what was typed the same
   way and compares. scrypt is deliberately slow, which makes guessing
   passwords from a stolen users.json expensive.

   Command line (run from the project folder):
     node backend/users.js list
     node backend/users.js add <username> <role> <password> [display name]
     node backend/users.js remove <username>
*/

const crypto = require('crypto');
const store = require('./store');

const ROLES = ['analyst', 'risk', 'admin'];
const FILE = 'users.json';

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

// Adds an account, or replaces it if the username already exists.
function addUser(username, role, password, name) {
    const problem = checkNewUser(username, role, password);
    if (problem) throw new Error(problem);
    const users = loadUsers().filter(function (u) { return u.username !== username; });
    const salt = crypto.randomBytes(16).toString('hex');
    users.push({ username: username, name: name || username, role: role,
                 salt: salt, hash: hashPassword(password, salt) });
    store.writeJson(FILE, users);
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

// First start: no accounts yet, so create one per role with a random
// password, and save the passwords where only this machine can read them.
function ensureDemoUsers() {
    if (loadUsers().length > 0) return null;
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

module.exports = { ROLES, addUser, removeUser, verify, listUsers, ensureDemoUsers };


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
        } else {
            console.log('usage:\n  node backend/users.js list\n' +
                        '  node backend/users.js add <username> <role> <password> [display name]\n' +
                        '  node backend/users.js remove <username>\nroles: ' + ROLES.join(', '));
            process.exitCode = 1;
        }
    } catch (e) {
        console.error('error: ' + e.message);
        process.exitCode = 1;
    }
}
