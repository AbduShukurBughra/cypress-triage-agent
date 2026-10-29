import "./env.js"; // must stay first: loads .env before anything reads it
import Anthropic from "@anthropic-ai/sdk";
import { tools } from "./tools.js";

// Reads credentials from ANTHROPIC_API_KEY (loaded from .env by ./env.js)
// or an `ant auth login` profile.
const client = new Anthropic();

const MAX_TURNS = 10; // safety net, like a Cypress timeout

const SYSTEM_PROMPT = `You are a QA assistant that triages failing Cypress tests.
Use the tools to look at the test results and the relevant spec files.
If it's unclear whether a failure is real or flaky, re-run the spec with run_cypress_spec.
For each failure, explain the most likely root cause and suggest a concrete fix.
To apply a fix, call write_file with the complete new file; the user approves each change.
After an approved fix, re-run the spec to check that it worked.
Be concise.`;

async function runAgent(task: string): Promise<void> {
  // The Tool Runner owns the loop: call Claude, run the tools it asks for,
  // send the results back, repeat until Claude is done or MAX_TURNS is hit.
  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium" }, // low | medium | high | xhigh | max
    // If a safety filter wrongly declines, retry on a fallback model automatically.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    tools,
    messages: [{ role: "user", content: task }],
    max_iterations: MAX_TURNS,
  });

  // Each iteration is one reply from Claude. We only print it; the runner
  // runs any requested tools after this loop body finishes.
  let turn = 0;
  let last: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    turn++;
    last = message;
    for (const block of message.content) {
      if (block.type === "text") console.log(block.text);
      if (block.type === "tool_use") {
        console.log(`\n🔧 [turn ${turn}] ${block.name}(${JSON.stringify(block.input)})`);
      }
    }
  }

  // Report why it stopped if it wasn't a normal finish.
  switch (last?.stop_reason) {
    case "end_turn":
      break;
    case "tool_use":
      console.error(`Gave up after ${MAX_TURNS} turns.`);
      break;
    case "refusal":
      console.error("Claude declined:", last.stop_details?.explanation);
      break;
    default:
      console.error(`Stopped early: ${last?.stop_reason}`);
  }
}

const task = process.argv.slice(2).join(" ") || "Why are my tests failing? How do I fix them?";
console.log(`📝 Task: ${task}\n`);

try {
  await runAgent(task);
} catch (err) {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("Authentication failed: set ANTHROPIC_API_KEY or run `ant auth login`.");
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error("Rate limited, try again in a moment.");
  } else if (err instanceof Anthropic.APIError) {
    console.error(`API error ${err.status}: ${err.message}`);
  } else {
    throw err;
  }
  process.exitCode = 1;
}
