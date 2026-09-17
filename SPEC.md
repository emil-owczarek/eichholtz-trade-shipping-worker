# Eichholtz Miami — Trade Shipping Carrier Service Worker

Build a Cloudflare Worker that acts as the `callback_url` for a Shopify
CarrierService, implementing a dynamic 8%-of-subtotal shipping fee for
trade customers, with a free-shipping threshold that varies by loyalty
tier.

## Business logic

Customer tags (case-insensitive, may be combined e.g. `["DLP","SILVER"]`):

| Priority | Tag match | Free shipping threshold |
|---|---|---|
| 1 (highest) | `PLATINUM` | $5,000 |
| 2 | `GOLD` | $7,500 |
| 3 | `SILVER` or `DLP` (with no Gold/Platinum) | $10,000 |
| — | none of the above | not a trade customer — return `{"rates": []}`, HTTP 200 |

For a trade customer:
- If `subtotal >= threshold`: return ONE rate, `total_price: "0"`,
  `description: "Free — you qualify for free Trade shipping"`.
- If `subtotal < threshold`: return ONE rate, `total_price` = subtotal
  × 0.08, rounded to the nearest cent, expressed as a STRING OF CENTS
  (Shopify's rate format: dollars × 100, e.g. subtotal $500.00 → fee
  $40.00 → `"total_price": "4000"`).
- `service_name`: `"Eichholtz Trade Shipping"`
- `service_code`: `"EICHHOLTZ_TRADE_8PCT"`
- `currency`: echo back whatever `rate.currency` was in the request
  (fall back to `"USD"` if absent).

Non-trade customers and any request Shopify can't be billed for get an
empty `rates` array with HTTP 200 — this is Shopify's documented way
of saying "this carrier has nothing to offer," and it leaves the
store's existing General-profile rates (Curbside/White Glove)
completely unaffected.

## Payload shape — IMPORTANT, not fully verified from Shopify's docs

Shopify's classic CarrierService payload is:
```json
{ "rate": { "origin": {...}, "destination": {...}, "items": [...],
             "currency": "USD", "locale": "en" } }
```
As of a Nov 2025 API change, Shopify ALSO includes order totals and
customer tags in the same payload, but I could not confirm the exact
JSON nesting from Shopify's docs (no verbatim example was published).
The two most likely shapes, based on how the rest of the payload is
structured (everything lives under `rate`), are:

- `rate.order_totals.subtotal_price` / `rate.order_totals.total_price`
  / `rate.order_totals.discount_amount`
- `rate.customer.id` / `rate.customer.tags` (tags likely a comma
  string OR an array — unconfirmed)

**Write the parsing code defensively**: try `rate.order_totals?.subtotal_price`
first, then fall back to `rate.order?.subtotal_price`, then fall back to
summing `rate.items[].price × quantity` (price is in CENTS per the
classic payload, so divide by 100) as a last resort so the Worker
never hard-crashes even if the new fields are missing on a given
request. Same defensive approach for tags: try `rate.customer?.tags`
as an array, then as a comma-separated string (split + trim +
uppercase), then `rate.customer_tags`, then treat as "no tags found"
(non-trade) if nothing matches — never throw.

Log the FULL raw request body (via `console.log(JSON.stringify(body))`)
on every request unconditionally for now — this is temporary and
needed to empirically confirm the real field names via `wrangler tail`
during the draft-order test phase described below. Note this clearly
in a code comment AND in the README as something to remove/gate behind
a debug flag once field names are confirmed live.

## Security

Shopify does NOT HMAC-sign CarrierService callback requests (unlike
webhooks). Add a shared-secret check: require a query string param
`?key=<secret>` on the callback URL, read the expected value from a
Worker secret/env var `CALLBACK_SECRET` (set via `wrangler secret put
CALLBACK_SECRET`), and return HTTP 401 with no body if it doesn't
match. This keeps the calculation endpoint from being probed/abused by
random internet traffic while requiring zero changes to the payload
Shopify sends (the secret lives in the `callbackUrl` itself, which is
private admin config).

## Deliverables

- `wrangler.jsonc` — minimal Worker config (name: `eichholtz-trade-shipping`,
  compatibility_date = today, main = `src/index.js`)
- `src/index.js` — the Worker (ES module `export default { async fetch(request, env) {...} }`)
- `README.md` — deploy steps (`wrangler deploy`, `wrangler secret put CALLBACK_SECRET`),
  how to tail logs (`wrangler tail`) during the draft-order verification step,
  and a short note on what to check once real Shopify traffic is observed
  (confirm actual `order_totals`/`customer` field paths, then simplify the
  defensive fallback chain to just the confirmed path).
- `test/manual-curl.sh` — a small script with 4-5 `curl` examples against
  a local `wrangler dev` server: (1) no tags → expect `{"rates":[]}`,
  (2) SILVER tag, subtotal $6,495 → expect ~$519.60 fee, (3) SILVER tag,
  subtotal $10,500 → expect $0/free, (4) GOLD tag, subtotal $7,600 →
  expect $0/free, (5) PLATINUM tag, subtotal $4,000 → expect $320 fee.
  Use the classic payload shape (items array) for these since that's the
  one confirmed from Shopify's docs, so the curl examples exercise the
  fallback-to-items-sum code path too.

## Conventions

No code comments except where the WHY is genuinely non-obvious (the
defensive-parsing rationale above, and the temporary full-payload
logging, both qualify). No unrequested abstractions — this is a single
small handler, keep it flat and readable, not over-engineered into
multiple files/classes.

## Verification before reporting done

Run `node --check src/index.js` (or equivalent) to confirm no syntax
errors. If `wrangler` is available locally, run `wrangler dev` and
exercise all 5 curl cases from `test/manual-curl.sh`, pasting the
actual output. If `wrangler`/Cloudflare auth isn't available in this
environment, say so explicitly rather than claiming it was tested.
