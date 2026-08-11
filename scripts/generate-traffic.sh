#!/usr/bin/env bash
#
# Sends a mix of valid and invalid orders to order-service so you have
# real traffic (successes, 4xx, and out-of-stock errors) to see in your
# logs, metrics, and dashboard right away.
#
# Usage:
#   ./generate-traffic.sh [order-service-url] [requests] [delay-seconds]
#
# Example:
#   ./generate-traffic.sh http://localhost:3000 100 0.5

BASE_URL="${1:-http://localhost:3000}"
REQUESTS="${2:-50}"
DELAY="${3:-0.5}"

SKUS=("SKU-001" "SKU-002" "SKU-003" "SKU-004" "SKU-DOES-NOT-EXIST")

echo "Sending $REQUESTS requests to $BASE_URL/orders (delay: ${DELAY}s)..."

for i in $(seq 1 "$REQUESTS"); do
  SKU=${SKUS[$RANDOM % ${#SKUS[@]}]}
  QUANTITY=$(( (RANDOM % 3) + 1 ))

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/orders" \
    -H "Content-Type: application/json" \
    -d "{\"sku\": \"$SKU\", \"quantity\": $QUANTITY, \"customerId\": \"cust-$((RANDOM % 20))\"}")

  echo "[$i/$REQUESTS] POST /orders sku=$SKU qty=$QUANTITY -> $STATUS"
  sleep "$DELAY"
done

echo "Done. Check your CloudWatch Logs / metrics / dashboard now."
