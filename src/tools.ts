import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createPatch } from "diff";
import { execFile, type ExecFileException } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// The agent may only read files inside this folder.
const PROJECT_ROOT = path.resolve(process.cwd());

// Use the project's own Cypress. `npx cypress` would silently download it if missing.
const CYPRESS_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "cypress");
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_CHARS = 8000; // keep long Cypress logs from flooding the conversation

// ---------------------------------------------------------------------------
// The tools. Each one bundles what Claude sees (name, description, input
// schema) with the code that runs. Zod checks Claude's input against the
// schema before `run` is called, and an error thrown from `run` goes back to
// Claude as an error result it can react to.
// ---------------------------------------------------------------------------
const getTestResultsTool = betaZodTool({
  name: "get_test_results",
  description:
    "Returns the latest Cypress test run as JSON: spec file, test title, state, " +
    "duration and error message for each test.",
  inputSchema: z.object({
    only_failed: z.boolean().optional().describe("If true, return only failed tests."),
  }),
  run: (input) => getTestResults(input),
});

const readFileTool = betaZodTool({
  name: "read_file",
  description:
    "Reads a text file from the project, e.g. a Cypress spec. " +
    "Path is relative to the project root, like 'cypress/e2e/login.cy.ts'.",
  inputSchema: z.object({
    path: z.string().describe("Relative file path."),
  }),
  run: (input) => readProjectFile(input),
});

const runCypressSpecTool = betaZodTool({
  name: "run_cypress_spec",
  description:
    "Runs one Cypress spec headlessly and returns the exit code and the end of the " +
    "console output. Exit code 0 means every test passed; otherwise it is the number " +
    "of failed tests. Can take a few minutes. Use it to check whether a failure " +
    "reproduces or is flaky.",
  inputSchema: z.object({
    spec: z.string().describe("Spec path relative to the project root, like 'cypress/e2e/login.cy.ts'."),
  }),
  run: (input) => oneAtATime(() => runCypressSpec(input)),
});

const writeFileTool = betaZodTool({
  name: "write_file",
  description:
    "Creates or overwrites a file under cypress/ with the given content. Send the " +
    "complete new file, not a snippet. The user sees a diff and must approve it; if " +
    "they reject it, the file is left unchanged.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the project root, like 'cypress/e2e/login.cy.ts'."),
    content: z.string().describe("The complete new file content."),
  }),
  run: (input) => oneAtATime(() => writeProjectFile(input)),
});

export const tools = [getTestResultsTool, readFileTool, runCypressSpecTool, writeFileTool];

// ---------------------------------------------------------------------------
// The code behind the tools. It runs on your machine when Claude asks.
// ---------------------------------------------------------------------------
type TestResult = { spec: string; title: string; state: string; error?: string };

// The runner runs a reply's tool calls in parallel. Tools with side effects
// go through this queue so they run one after another: each diff and its
// [y/N] prompt stay together, and two Cypress runs never overlap.
let sideEffectQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const result = sideEffectQueue.then(task);
  sideEffectQueue = result.catch(() => {}); // a failed task must not block the next one
  return result;
}

// Paths come from the model, so treat them as untrusted input:
// block "../../etc/passwd"-style escapes outside the project folder.
function resolveInProject(p: string): string {
  const target = path.resolve(PROJECT_ROOT, p);
  const relative = path.relative(PROJECT_ROOT, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the project folder.");
  }
  return relative;
}

async function getTestResults(input: { only_failed?: boolean }): Promise<string> {
  const raw = await readFile(path.join(PROJECT_ROOT, "test-results/results.json"), "utf8");
  const run = JSON.parse(raw) as { tests: TestResult[] };
  const tests = input.only_failed ? run.tests.filter((t) => t.state === "failed") : run.tests;
  return JSON.stringify(tests, null, 2);
}

async function readProjectFile(input: { path: string }): Promise<string> {
  const relative = resolveInProject(input.path);
  if (relative.split(path.sep)[0] === "node_modules") {
    throw new Error("Reading node_modules is not allowed.");
  }
  return readFile(path.join(PROJECT_ROOT, relative), "utf8");
}

async function runCypressSpec(input: { spec: string }): Promise<string> {
  const spec = resolveInProject(input.spec);
  if (spec.split(path.sep)[0] !== "cypress" || !/\.cy\.[jt]sx?$/.test(spec)) {
    throw new Error("Only spec files under cypress/ (*.cy.ts, *.cy.js) can be run.");
  }
  await access(path.join(PROJECT_ROOT, spec)).catch(() => {
    throw new Error(`Spec not found: ${spec}`);
  });
  await access(CYPRESS_BIN).catch(() => {
    throw new Error("Cypress is not installed in this project. Install it with: npm install -D cypress");
  });

  try {
    // execFile passes arguments directly, with no shell, so the spec path can't inject commands.
    const { stdout, stderr } = await execFileAsync(CYPRESS_BIN, ["run", "--spec", spec], {
      cwd: PROJECT_ROOT,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return formatRun(0, stdout + stderr);
  } catch (err) {
    // Cypress exits with the number of failed tests, which rejects the promise.
    // That's a normal result for Claude to read, not a tool failure.
    const e = err as ExecFileException & { stdout?: string; stderr?: string };
    if (e.killed) throw new Error(`Cypress run timed out after ${RUN_TIMEOUT_MS / 60000} minutes.`);
    if (typeof e.code !== "number") throw err; // couldn't start at all
    return formatRun(e.code, (e.stdout ?? "") + (e.stderr ?? ""));
  }
}

async function writeProjectFile(input: { path: string; content: string }): Promise<string> {
  const relative = resolveInProject(input.path);
  if (relative.split(path.sep)[0] !== "cypress") {
    throw new Error("Only files under cypress/ can be written.");
  }
  const target = path.join(PROJECT_ROOT, relative);
  const before = await readFile(target, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null; // new file
    throw err;
  });
  if (before === input.content) return "No changes: the file already has this content.";

  // Show the human exactly what would change, then ask.
  console.log(`\n✏️  Claude wants to ${before === null ? "create" : "change"} ${relative}:\n`);
  console.log(createPatch(relative, before ?? "", input.content));
  if (!(await askYesNo("Apply this change? [y/N] "))) {
    // A refusal is an answer for Claude to work with, not a tool failure.
    return "The user rejected this change and the file was not modified. Don't retry the same change; describe the fix instead.";
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, input.content, "utf8");
  return `Wrote ${relative}.`;
}

// Asks the human in the terminal. Without a terminal (CI, piped input) the answer is always no.
async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log("(no terminal to ask in, so the change is refused)");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

function formatRun(exitCode: number, output: string): string {
  // Cypress prints its summary at the end, so keep the tail.
  const tail =
    output.length > MAX_OUTPUT_CHARS
      ? "...(earlier output trimmed)\n" + output.slice(-MAX_OUTPUT_CHARS)
      : output;
  return `exit code: ${exitCode}\n\n${tail}`;
}
