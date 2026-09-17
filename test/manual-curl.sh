#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-http://localhost:8787}"
CALLBACK_SECRET="${CALLBACK_SECRET:-local-secret}"
ENCODED_CALLBACK_SECRET="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$CALLBACK_SECRET")"
URL="${BASE_URL}/?key=${ENCODED_CALLBACK_SECRET}"

post_rate() {
  label="$1"
  payload="$2"

  printf '\n%s\n' "$label"
  curl -sS -X POST "$URL" \
    -H 'Content-Type: application/json' \
    --data "$payload"
  printf '\n'
}

post_rate '1. No tags: expect {"rates":[]}' '{
  "rate": {
    "currency": "USD",
    "items": [{ "price": 100000, "quantity": 1 }]
  }
}'

post_rate '2. SILVER, subtotal $6,495: expect total_price "51960"' '{
  "rate": {
    "currency": "USD",
    "customer": { "tags": ["SILVER"] },
    "items": [{ "price": 649500, "quantity": 1 }]
  }
}'

post_rate '3. SILVER, subtotal $10,500: expect free total_price "0"' '{
  "rate": {
    "currency": "USD",
    "customer": { "tags": ["SILVER"] },
    "items": [{ "price": 1050000, "quantity": 1 }]
  }
}'

post_rate '4. GOLD, subtotal $7,600: expect free total_price "0"' '{
  "rate": {
    "currency": "USD",
    "customer": { "tags": "gold" },
    "items": [{ "price": 760000, "quantity": 1 }]
  }
}'

post_rate '5. PLATINUM, subtotal $4,000: expect total_price "32000"' '{
  "rate": {
    "currency": "USD",
    "customer_tags": "PLATINUM",
    "items": [{ "price": 400000, "quantity": 1 }]
  }
}'
