import http from "node:http";
import { writeFileSync, readFileSync } from "node:fs";

const PORT = 8787;
const SHOP = "gnbdgq-9w.myshopify.com";
const { CLIENT_ID, CLIENT_SECRET, STATE } = JSON.parse(readFileSync(new URL("./.oauth_run.local.json", import.meta.url)));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/start") {
    const authorizeUrl = `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=write_shipping&redirect_uri=${encodeURIComponent(`http://localhost:${PORT}/callback`)}&state=${STATE}`;
    res.writeHead(302, { Location: authorizeUrl }).end();
    return;
  }

  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (state !== STATE) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("State mismatch — possible CSRF, aborting.");
    console.log(JSON.stringify({ error: "state_mismatch", got: state }));
    return;
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("No code in callback.");
    return;
  }

  try {
    const tokenResponse = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    });

    const tokenBody = await tokenResponse.text();

    if (!tokenResponse.ok) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }).end("Token exchange failed, see server log.");
      console.log(JSON.stringify({ error: "token_exchange_failed", status: tokenResponse.status, body: tokenBody }));
      return;
    }

    const parsed = JSON.parse(tokenBody);
    writeFileSync(new URL("./.admin_access_token.local.json", import.meta.url), JSON.stringify(parsed, null, 2));

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Success — access token received. You can close this tab.");
    console.log(JSON.stringify({ success: true, scope: parsed.scope }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Unexpected error, see server log.");
    console.log(JSON.stringify({ error: "unexpected", message: String(error) }));
  } finally {
    setTimeout(() => process.exit(0), 500);
  }
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ listening_on: `http://localhost:${PORT}/callback` }));
});
