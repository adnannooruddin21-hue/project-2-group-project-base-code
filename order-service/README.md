# Order Service

Basic order-creation API. Owned by the partner responsible for the "order" side of the split-service team project. Calls `inventory-service` to reserve stock before confirming an order.

## Endpoints

| Method | Path           | Description                                  |
|--------|----------------|-----------------------------------------------|
| GET    | `/health`      | Health check                                   |
| POST   | `/orders`      | Create an order (reserves stock via inventory-service) |
| GET    | `/orders/:id`  | Get an order by ID                             |

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Runs on `http://localhost:3000` by default. Requires `inventory-service` to be running (see `INVENTORY_SERVICE_URL` in `.env`).

## Example requests

```bash
curl http://localhost:3000/health

# Successful order
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"sku": "SKU-001", "quantity": 2, "customerId": "cust-1"}'

# Triggers a 409 from inventory-service (SKU-004 is seeded at 0 stock)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"sku": "SKU-004", "quantity": 1, "customerId": "cust-1"}'

curl http://localhost:3000/orders/1
```

## Your work starts here

See the `// TODO:` blocks in `server.js` for where to add correlation ID generation/forwarding, structured logging, and custom metrics. This service is where the correlation ID chain *starts* — it should generate one if the caller didn't supply one, then forward it on the call to `inventory-service`.
