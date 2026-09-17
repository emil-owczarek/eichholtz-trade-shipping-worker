const RATE_NAME = "Eichholtz Trade Shipping";
const RATE_CODE = "EICHHOLTZ_TRADE_8PCT";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!(await secretMatches(url.searchParams.get("key") || "", env.CALLBACK_SECRET || ""))) {
      return new Response(null, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    // Temporary draft-order instrumentation: remove this or gate it behind a debug flag once Shopify's real callback field paths are confirmed.
    safeLogJson(body);

    if (!body || typeof body !== "object") {
      return jsonRates([]);
    }

    const rate = body.rate && typeof body.rate === "object" ? body.rate : {};
    const tags = customerTags(rate);
    const thresholdCents = freeShippingThresholdCents(tags);

    if (!thresholdCents) {
      return jsonRates([]);
    }

    const subtotal = subtotalFromRate(rate);

    if (subtotal === null) {
      return jsonRates([]);
    }

    safeLogJson({
      subtotal_source: subtotal.source,
      warning: subtotal.source === "items_sum"
        ? "items_sum fallback excludes non-shippable line items; confirm Shopify sent no order_totals/order subtotal"
        : undefined,
    });

    const currency = typeof rate.currency === "string" && rate.currency.trim() ? rate.currency : "USD";
    const isFree = subtotal.cents >= thresholdCents;

    return jsonRates([
      {
        service_name: RATE_NAME,
        service_code: RATE_CODE,
        total_price: isFree ? "0" : String(Math.round(subtotal.cents * 0.08)),
        currency,
        description: isFree
          ? "Free — you qualify for free Trade shipping"
          : "8% Trade shipping",
      },
    ]);
  },
};

async function secretMatches(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  const actualHash = await crypto.subtle.digest("SHA-256", actualBytes);
  const expectedHash = await crypto.subtle.digest("SHA-256", expectedBytes);

  return bytesEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

function bytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}

function customerTags(rate) {
  const customerTagsValue = rate.customer && typeof rate.customer === "object"
    ? rate.customer.tags
    : undefined;

  if (Array.isArray(customerTagsValue)) {
    return normalizeTags(customerTagsValue);
  }

  if (typeof customerTagsValue === "string") {
    return normalizeTags(customerTagsValue.split(","));
  }

  if (Array.isArray(rate.customer_tags)) {
    return normalizeTags(rate.customer_tags);
  }

  if (typeof rate.customer_tags === "string") {
    return normalizeTags(rate.customer_tags.split(","));
  }

  return [];
}

function normalizeTags(tags) {
  return tags
    .map((tag) => String(tag).trim().toUpperCase())
    .filter(Boolean);
}

function freeShippingThresholdCents(tags) {
  if (tags.includes("PLATINUM")) {
    return 500000;
  }

  if (tags.includes("GOLD")) {
    return 750000;
  }

  if (tags.includes("SILVER") || tags.includes("DLP")) {
    return 1000000;
  }

  return null;
}

function subtotalFromRate(rate) {
  // Shopify's Nov 2025 total/customer fields did not have a confirmed published shape when this was written, so keep these fallbacks until live traffic confirms the actual paths.
  const candidates = [
    ["order_totals", rate.order_totals?.subtotal_price],
    ["order", rate.order?.subtotal_price],
  ];

  for (const [source, candidate] of candidates) {
    const cents = integerCents(candidate);
    if (cents !== null) {
      return { cents, source };
    }
  }

  if (!Array.isArray(rate.items)) {
    return null;
  }

  let subtotalCents = 0;
  let hasBillableItem = false;
  for (const item of rate.items) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const priceCents = integerCents(item.price);
    const quantity = item.quantity === undefined ? 1 : Number(item.quantity);

    if (priceCents === null || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      return null;
    }

    hasBillableItem = true;
    subtotalCents += priceCents * quantity;
  }

  return hasBillableItem && Number.isFinite(subtotalCents)
    ? { cents: Math.round(subtotalCents), source: "items_sum" }
    : null;
}

function integerCents(value) {
  let amount;

  if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    amount = Number(normalized);
  } else {
    return null;
  }

  if (!Number.isSafeInteger(amount) || amount < 0) {
    return null;
  }

  return amount;
}

function jsonRates(rates) {
  return new Response(JSON.stringify({ rates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function safeLogJson(value) {
  try {
    console.log(JSON.stringify(value));
  } catch (error) {
    console.log(JSON.stringify({
      log_error: "failed_to_serialize_debug_payload",
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}
