# Eichholtz Trade Shipping Worker

Cloudflare Worker callback endpoint for a Shopify CarrierService. It returns a dynamic trade shipping rate equal to 8% of subtotal, with free shipping thresholds by customer loyalty tag.

## Deploy

Set the shared callback secret before deploying:

```sh
wrangler secret put CALLBACK_SECRET
wrangler deploy
```

Configure Shopify's CarrierService `callback_url` with the secret as a query string parameter:

```text
https://<worker-hostname>/?key=<CALLBACK_SECRET>
```

URL-encode `CALLBACK_SECRET` in the query string if it contains special characters such as `+`, `&`, `#`, or `%`.

## Local Manual Check

Run Wrangler locally with a development secret:

```sh
printf 'CALLBACK_SECRET=local-secret\n' > .dev.vars
wrangler dev
```

Then, in another terminal:

```sh
CALLBACK_SECRET=local-secret test/manual-curl.sh
```

## Draft-Order Verification

Tail live logs while placing draft-order test traffic through Shopify:

```sh
wrangler tail
```

The Worker currently logs the full parsed request body on every authorized request so the real Shopify payload paths can be confirmed. Remove that logging, or gate it behind a debug flag, once the draft-order test confirms the actual `order_totals` and `customer` field paths.

Once real traffic is observed, confirm whether Shopify sends totals and tags as `rate.order_totals.subtotal_price` / `rate.customer.tags` or another path, then simplify the defensive fallback chain in `src/index.js` to the confirmed fields.
