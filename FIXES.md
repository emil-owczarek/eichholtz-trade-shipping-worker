# Fixes required from cross-review (gpt-5.6-sol, adversarial pass)

Apply these to `src/index.js` (and `test/manual-curl.sh` / `README.md`
where noted). Original spec is in `SPEC.md` — these fixes take
precedence where they conflict with it.

## 1. CRITICAL — order_totals/order subtotal is likely double-converted to cents

`subtotalFromRate()` currently runs `rate.order_totals?.subtotal_price`
and `rate.order?.subtotal_price` through `moneyToCents()`, which does
`Number(value) * 100`. Shopify's classic CarrierService payload
documents `items[].price` as already being in cents (example:
`"price": 1999` for a $19.99 item), and real-world payload reports for
the newer `order_totals` fields show the same subunit convention (e.g.
`"subtotal_price": 649500` meaning $6,495.00, not $6,495.00 × 100).

Fix: for the `order_totals.subtotal_price` and `order.subtotal_price`
candidates, treat the value as **already in cents** — use the same
`integerCents()` helper already used for `items[].price`, not
`moneyToCents()`. Keep `moneyToCents()` only if it's still needed
elsewhere after this change; if it becomes unused, delete it (no dead
code).

Keep the temporary full-payload `console.log` in place — this is
still an inference from indirect evidence, not a confirmed fact from
Shopify's own docs, so the empirical draft-order test remains the real
verification step. Add one extra `console.log` line specifically
noting which candidate path was used to compute the returned subtotal
(e.g. `"subtotal_source": "order_totals"` / `"order"` / `"items_sum"`)
so that's visible in `wrangler tail` output during that test.

## 2. HIGH — malformed items must invalidate the whole items-sum fallback, not just be skipped

In the current loop, an item with a bad `price` or `quantity` is
silently skipped while the rest of the items are still summed and
billed — this can undercharge. Change it: if ANY item in `rate.items`
is malformed (not an object, price not a finite non-negative number,
or quantity not a finite positive integer — do not accept fractional
quantities, and treat a genuinely missing `quantity` as `1` since
that's normal, not malformed), the entire items-sum fallback must
fail (return `null`), which flows through to `{"rates": []}`. Partial
sums are not acceptable for a real-money percentage fee.

Also fix the broad `Number()` coercion in `integerCents()` so
`null`, `""`, `false`, and non-numeric strings are rejected (return
`null`) instead of silently becoming `0`.

## 3. HIGH — items-sum fallback structurally excludes non-shippable line items

This is inherent to the fallback (Shopify's `items` array only
includes items that require shipping, so its sum can be lower than
the true order subtotal) — keep the fallback (the manual test script
and current environment's lack of a confirmed `order_totals` example
both depend on it), but:
- Log a clear warning marker when this fallback path is used (see the
  `subtotal_source` logging in item 1) so real traffic hitting this
  path is visible and treated as a signal that `order_totals`/`order`
  were missing on that request — worth following up on, not silently
  normal.
- Do not otherwise change its math; this is a documented, accepted
  limitation of the fallback, not a bug to "fix" further.

## 4. MEDIUM — decimal-string parsing has binary float rounding risk

If `moneyToCents()` is still used anywhere after fix #1 (e.g. as a
last-resort candidate for a dollar-decimal-formatted value), fix the
rounding: don't do `Number(value) * 100` blindly. Parse the string on
the decimal point, take the integer part × 100 plus the fractional
part parsed as its own 2-digit integer (padded/truncated to 2 digits),
so `"1.005"` doesn't silently misround through float multiplication.
If `moneyToCents()` ends up unused after fix #1, delete it instead of
fixing dead code.

## 5. LOW — uncaught exception risk from logging

Wrap the temporary `console.log(JSON.stringify(body))` call in a
try/catch (or a small helper) so a pathological payload (very deep
nesting, oversized body) can't throw past it and produce an unhandled
exception. This is temporary debug instrumentation, not core logic —
it must never be able to crash the response path.

## 6. LOW — secret handling in docs/scripts

- `test/manual-curl.sh`: URL-encode the secret when building the
  query string (don't just interpolate it raw) so secrets containing
  `+`, `&`, `#`, `%`, etc. don't silently break auth in the example.
- `README.md`: same note wherever the callback URL with `?key=...` is
  shown — mention the secret must be URL-encoded if it contains
  special characters.
- Add a `.gitignore` in this directory covering `.dev.vars` and
  `node_modules/`, since the README instructs creating `.dev.vars`
  locally and there's currently nothing preventing an accidental
  commit.

## Verification before reporting done

1. `node --check src/index.js`
2. Re-run the direct-invocation sanity check used last time (wrangler
   still isn't installed) covering: the 5 original cases from
   `test/manual-curl.sh`, PLUS new cases exercising these fixes:
   - `order_totals.subtotal_price: 649500` with a SILVER tag → must
     produce fee `"51960"`, NOT free shipping (this is the regression
     test for the critical bug)
   - an items array with one good item and one malformed item (e.g.
     `price: "bad"`) → must return `{"rates":[]}`, not a partial fee
   - an items array with a fractional quantity (e.g. `1.5`) → must
     return `{"rates":[]}`
   Paste the actual output, not a description of expected output.
3. Report which findings from the cross-review were fixed and confirm
   none of the "checks that passed" items (tag priority, auth,
   response shapes) were accidentally broken by these changes.
