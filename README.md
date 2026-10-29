# cypress-triage-agent

A small QA assistant that triages failing Cypress tests. Claude reads the test
results and spec files, re-runs a spec when needed, explains the most likely
cause of each failure and suggests a fix. You approve every file change before
it is made.

The project also includes a small local login page for the Cypress login tests
to run against.

## Requirements

- Node.js 20.12 or later (`.env` is loaded with `process.loadEnvFile`; tested on v24)
- An Anthropic API key ([platform.claude.com](https://platform.claude.com) → API Keys)
- Xvfb to run headless on a Linux server (`sudo apt install xvfb`)

## Setup

```bash
git clone https://github.com/AbduShukurBughra/cypress-triage-agent.git
cd cypress-triage-agent
npm install
cp .env.example .env   # then put your own ANTHROPIC_API_KEY in .env
```

`.env` is git-ignored; never commit it. Commit `.env.example` instead.

## Running the agent

```bash
npm run agent
```

Without a task, the agent uses the default: *"Why are my tests failing? How do I fix them?"*
You can also give it your own:

```bash
npm run agent -- "why is the login spec failing?"
```

The agent stops after at most 10 turns (`MAX_TURNS` in `src/agent.ts`).

### The agent's tools

| Tool | What it does |
|---|---|
| `get_test_results` | Returns the latest test results from `test-results/results.json` |
| `read_file` | Reads a file in the project (not `node_modules`) |
| `run_cypress_spec` | Runs one spec under `cypress/` headless (5-minute limit) |
| `write_file` | Creates or changes a file under `cypress/`; shows the diff first and asks for approval |

Safety rules:

- The agent can't reach files outside the project folder.
- It can only write under `cypress/`.
- You approve each change in the terminal with `[y/N]`. Without a terminal
  (CI, piped input), changes are refused automatically.

> **Note:** `test-results/results.json` is not updated automatically. The agent
> may read old results from it, so keep it current after a new run.

## Cypress tests

```bash
npx cypress run --spec cypress/e2e/login.cy.ts   # one spec
npx cypress run                                  # every spec under cypress/e2e/
```

`cypress.config.ts` starts the local login page (`cypress/support/login-app.ts`)
on `http://localhost:3000` before the specs run and stops it when they finish,
so there's no separate server to start. If port 3000 is taken, pick another:

```bash
LOGIN_APP_PORT=4000 npx cypress run
```

The local login page:

| Route | Behavior |
|---|---|
| `/login` | Email and password form |
| `POST /login` | Redirects to `/dashboard` on valid credentials, otherwise shows "Invalid credentials" |
| `/dashboard` | Page shown after logging in |

The test account is `qa@example.com` / `correct-horse`. It only works against
this local page.

> If Chrome or Firefox isn't installed, Cypress falls back to its built-in
> Electron browser and warns that Electron is deprecated. Install Chrome and add
> `--browser chrome` to avoid it.

## Project structure

```
.
├── cypress/
│   ├── e2e/login.cy.ts          # login tests
│   └── support/login-app.ts     # local login page for the tests
├── src/
│   ├── agent.ts                 # agent loop (Claude Tool Runner)
│   ├── env.ts                   # loads .env
│   └── tools.ts                 # the agent's tools
├── test-results/results.json    # test results the agent reads
├── cypress.config.ts
├── .env.example
└── tsconfig.json
```

## Other commands

```bash
npm run typecheck   # TypeScript type check (src/)
```
