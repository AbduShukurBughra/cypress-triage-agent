import { defineConfig } from "cypress";
import { startLoginApp } from "./cypress/support/login-app";

// Port for the local login app. Override with LOGIN_APP_PORT if 3000 is taken.
const PORT = Number(process.env.LOGIN_APP_PORT ?? 3000);

export default defineConfig({
  e2e: {
    baseUrl: `http://localhost:${PORT}`,
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
    supportFile: false,
    video: false,
    // Runs in Node before any spec: start the app the specs test against,
    // so `cypress run` needs no separate server step.
    async setupNodeEvents(on) {
      const server = await startLoginApp(PORT);
      on("after:run", () => {
        server.close();
      });
    },
  },
});
