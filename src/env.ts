// Loads variables from .env into process.env. Import this first, before
// anything that reads the environment (like `new Anthropic()`).
// Variables already set in the shell win over the file.
try {
  process.loadEnvFile(".env");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // no .env file is fine
}

// An empty `ANTHROPIC_API_KEY=` line counts as "not set", so it doesn't hide
// other sign-in methods such as an `ant auth login` profile.
if (process.env.ANTHROPIC_API_KEY === "") delete process.env.ANTHROPIC_API_KEY;

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("⚠️  No ANTHROPIC_API_KEY found. Add it to .env (see .env.example).\n");
}
