# Setting up options-engine on your computer

This guide takes you from nothing to the platform running in your browser.
It takes about 15 minutes the first time. Everything runs on your own
computer; nothing is deployed anywhere.

What you will end up with:

```
your browser  →  http://localhost:10241/app.html
                       │
                 Node.js server (backend/server.js)
                       │
                 C++ engine (./pricer), compiled on your machine
```


## 1. Get access to the repository

The repository is private. Send Utpal your GitHub username; he adds you
under Settings → Collaborators on
https://github.com/Kabiraj-2005/options-engine, and you accept the invite
from the email GitHub sends you.


## 2. Install the three tools

You need **git**, a **C++ compiler (g++)** and **Node.js 18 or newer**.
No npm packages are needed.

### macOS

Open Terminal and run:

```
xcode-select --install
```

That installs git and g++. Then install Node.js (the "LTS" version) from
https://nodejs.org.

### Linux (Ubuntu / Debian)

```
sudo apt update
sudo apt install git g++
```

Install Node.js from https://nodejs.org (or with nvm). Do not rely on
`apt install nodejs` on older Ubuntu versions: it can install a version
that is too old.

### Windows

The easiest route is WSL, which gives you a real Linux terminal inside
Windows:

1. Open PowerShell as administrator and run `wsl --install`, then restart.
2. Open the "Ubuntu" app from the Start menu and follow the Linux steps
   above inside it.
3. Do every step from here on inside that Ubuntu window.

Running natively on Windows (without WSL) has not been tested.

### Check everything is installed

```
git --version
g++ --version
node --version
```

All three should print a version. `node --version` must be `v18` or higher.


## 3. Download the project

```
git clone https://github.com/Kabiraj-2005/options-engine.git
cd options-engine
```

If git asks for a password, GitHub wants a personal access token, not your
GitHub password. The simplest fix is to install the GitHub CLI (`gh`), run
`gh auth login`, choose HTTPS and log in with your browser, then clone
again.

All later commands are run from inside this `options-engine` folder.


## 4. Build the engine

```
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
```

No output means it worked. Check it:

```
./pricer 4 --json --paths 1000000
```

You should see one line starting with `{"price":52.` (the exact numbers
vary slightly).


## 5. Start the server

```
node backend/server.js
```

You should see:

```
backend listening on http://localhost:10241  (platform: http://localhost:10241/app.html)
```

The first time, it also adds the team accounts:

```
added 12 team account(s) from backend/seed-users.json: utpal.analyst, ...
```

Leave this terminal open. The server only runs while it is open. Stop it
with Ctrl+C.


## 6. Open the platform in your browser

1. Go to http://localhost:10241/app.html
2. Sign in with one of **your three accounts**. Each team member has one
   per role, named `<name>.<role>`:

| Username | Can do |
|---|---|
| `<name>.analyst` (e.g. `harsh.analyst`) | Price options, see and cancel jobs |
| `<name>.risk` (e.g. `harsh.risk`) | See jobs and the dashboard (read only) |
| `<name>.admin` (e.g. `harsh.admin`) | Everything, plus the admin page (engine settings, users) |

`<name>` is one of `utpal`, `harsh`, `aryan`, `arya`. **Your passwords are
sent to you privately**; they are never in the repository. The same
accounts and passwords work on every computer that has the project.

The landing page is at http://localhost:10241/ and a quick "is the server
alive?" check is http://localhost:10241/health.

### How the accounts work

- `backend/seed-users.json` (in git) lists the team accounts with a
  **hash** of each password, not the password. A hash is a one-way
  fingerprint: the server can check a typed password against it, but it
  cannot be turned back into the password, so it is safe to share.
- When the server starts, it copies any team account your computer does not
  have yet into `data/users.json` (your own copy, not in git). Accounts
  already there are never changed or removed.

To add extra accounts on your own computer (they stay on your computer):

```
node backend/users.js add <username> <analyst|risk|admin> <password> [display name]
node backend/users.js list
```

Typing the `< >` is not needed; they only mark what to fill in.


## 7. Things to try

1. As your analyst account: price the default call. The result should be close to
   52.69, with delta close to 0.388.
2. Switch to Put and submit. The result should be close to 130.36.
3. Choose the Black-Scholes method: the answer is exact and instant.
4. Submit 100 million paths, then cancel it from the job queue while it is
   running.
5. Sign out, sign in as your risk account: you can see everything but
   cannot submit.
6. Sign in as your admin account: open the admin page and change the
   engine threads.
7. Stop the server (Ctrl+C), start it again: the job history is still
   there.


## 8. Getting the latest version later

```
git pull
g++ -std=c++17 -O2 -pthread src/pricer.cpp -o pricer
node backend/server.js
```

Always rebuild the engine after pulling; an old `pricer` may not understand
new options.


## If something goes wrong

| What you see | What to do |
|---|---|
| `EADDRINUSE ... 10241` | The server is already running in another terminal. Close it, or run on another port: `PORT=10242 node backend/server.js` and open http://localhost:10242/app.html |
| The website says the engine is not built | Run the g++ command from step 4 inside the project folder |
| A job fails with "engine failed" | Rebuild the engine (step 4); it is probably an old build |
| `node: command not found` | Node.js is not installed, or the terminal was opened before installing it. Open a new terminal |
| `node --version` shows v16 or lower | Install a newer Node.js from https://nodejs.org |
| `Cannot find module` | You are not in the `options-engine` folder. `cd` into it and try again |
| `Repository not found` when cloning | Your collaborator invite has not been accepted yet, or you are logged in to a different GitHub account |
| "Wrong username or password" | Usernames are `<name>.<role>`, all lowercase (e.g. `aryan.risk`). Check the password you were sent privately |
| Forgot your password | Ask for it again, or set a new one on your own computer: `node backend/users.js add <name>.<role> <role> <new password> "<Name> (<Role>)"`. That changes it on your computer only |
| Team accounts missing | Run `git pull`, then restart the server: missing team accounts are added on start |
