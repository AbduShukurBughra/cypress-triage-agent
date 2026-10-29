// A tiny login app for the Cypress specs to test against. No framework, no
// JavaScript in the page: a plain HTML form that posts back to /login.
// cypress.config.ts starts it before the specs run.
import http from "node:http";
import type { AddressInfo } from "node:net";

// Fake test account. Only valid against this local app.
const VALID_EMAIL = "qa@example.com";
const VALID_PASSWORD = "correct-horse";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
${body}
</body>
</html>`;
}

function loginPage(error?: string, email = ""): string {
  return page(
    "Log in",
    `<h1>Log in</h1>
${error ? `<p data-cy="login-error" role="alert">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/login">
  <label>Email <input data-cy="email" type="email" name="email" value="${escapeHtml(email)}" required></label>
  <label>Password <input data-cy="password" type="password" name="password" required></label>
  <button data-cy="login-submit" type="submit">Log in</button>
</form>`,
  );
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

function send(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  if (pathname === "/" || (pathname === "/login" && req.method === "GET")) {
    if (pathname === "/") {
      res.writeHead(302, { Location: "/login" }).end();
      return;
    }
    send(res, 200, loginPage());
    return;
  }

  if (pathname === "/login" && req.method === "POST") {
    const form = await readForm(req);
    const email = form.get("email") ?? "";
    if (email === VALID_EMAIL && form.get("password") === VALID_PASSWORD) {
      // 303 so the browser follows up with a GET /dashboard.
      res.writeHead(303, { Location: "/dashboard" }).end();
    } else {
      send(res, 401, loginPage("Invalid credentials", email));
    }
    return;
  }

  if (pathname === "/dashboard" && req.method === "GET") {
    send(res, 200, page("Dashboard", `<h1 data-cy="dashboard">Dashboard</h1>`));
    return;
  }

  send(res, 404, page("Not found", "<h1>Not found</h1>"));
}

// Resolves once the server is listening, so Cypress never visits too early.
export function startLoginApp(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, page("Error", "<h1>Server error</h1>"));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address() as AddressInfo;
      console.log(`Login app listening on http://localhost:${actual}`);
      resolve(server);
    });
  });
}
