/* Saving and loading the platform's data as JSON files.

   Everything lives in the data/ folder at the project root (not in git):
     data/jobs.json       job history, so it survives a server restart
     data/settings.json   engine settings changed on the admin page
     data/users.json      accounts, with hashed passwords (see users.js)

   Files are written "atomically": first to a temporary file, then renamed
   over the real one. A crash halfway through a write can then never leave a
   half-written, unreadable file behind.
*/

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function file(name) {
    return path.join(DATA_DIR, name);
}

function writeJson(name, data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const target = file(name);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, target);
}

// Returns the parsed file, or `fallback` if it does not exist yet. A file
// that exists but cannot be read is kept aside (renamed) rather than
// silently overwritten, so no data is lost without a trace.
function readJson(name, fallback) {
    const target = file(name);
    let text;
    try {
        text = fs.readFileSync(target, 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') return fallback;
        throw e;
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        const aside = target + '.unreadable-' + Date.now();
        fs.renameSync(target, aside);
        console.warn('warning: ' + target + ' was not valid JSON; moved it to ' + aside + ' and started fresh');
        return fallback;
    }
}

module.exports = { DATA_DIR, file, readJson, writeJson };
