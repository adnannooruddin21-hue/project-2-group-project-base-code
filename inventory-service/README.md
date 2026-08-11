# Inventory Service

Basic stock-reservation API. Owned by the partner responsible for the "inventory" side of the split-service team project.

## Endpoints

| Method | Path                  | Description                          |
|--------|-----------------------|---------------------------------------|
| GET    | `/health`             | Health check                          |
| GET    | `/inventory/:sku`     | Get current stock info for a SKU      |
| POST   | `/inventory/reserve`  | Reserve `quantity` units of `sku`     |

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Runs on `http://localhost:3001` by default (see `.env`).

## Example requests

```bash
curl http://localhost:3001/health

curl http://localhost:3001/inventory/SKU-001

curl -X POST http://localhost:3001/inventory/reserve \
  -H "Content-Type: application/json" \
  -d '{"sku": "SKU-001", "quantity": 2}'
```

## Seed data

Stock is seeded in-memory in `server.js` (`SKU-001` through `SKU-004`, one of which starts at 0 stock so you have an easy built-in way to trigger a 409 "insufficient stock" response).

## Your work starts here

See the `// TODO:` blocks in `server.js` for where to add correlation ID handling, structured logging, and custom metrics.
