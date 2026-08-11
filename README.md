# Project 2 Starter Code — Order Service & Inventory Service

This repo is starter code for the **team (split-by-service) option** of Project 2: Instrumented & Monitored Cloud Service.

**What this repo gives you:** two working Node.js/Express services with basic business logic already wired up, so you can spend your 3 days on deployment, instrumentation, dashboards, alerting, and incident response — not on writing CRUD routes.

**What this repo does NOT give you** (this is your project work — see the `TODO` comments in each `server.js`):

- Structured JSON logging
- Custom CloudWatch metrics
- Correlation ID generation and pass-through
- CloudWatch Logs Agent config
- Dashboards, alarms, SNS topics
- Auto-remediation Lambda
- Service map widget
- Cross-service Logs Insights queries
- Injected failure scenarios

Refer back to the main **Project 2** spec and the **Team Addendum** doc for full requirements — this repo only covers the "app" piece.

---

## Architecture

```
   client
     |
     v
+-------------------+        +----------------------+
|   order-service    | -----> |  inventory-service    |
|   (port 3000)      |  HTTP  |  (port 3001)          |
+-------------------+        +----------------------+
```

- **order-service** — `POST /orders`, `GET /orders/:id`, `GET /health`. On order creation, calls `inventory-service` to reserve stock before confirming the order.
- **inventory-service** — `GET /inventory/:sku`, `POST /inventory/reserve`, `GET /health`. Maintains in-memory stock levels.

Both services use an **in-memory data store** (a plain JS object) — no database required. Data resets when the process restarts. This is intentional: you're being graded on observability, not persistence.

---

## Repo Structure

```
ce-project-2-starter-code/
├── README.md                  (this file)
├── docker-compose.yml         (run both services locally in one command)
├── order-service/
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   └── README.md
├── inventory-service/
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   └── README.md
└── scripts/
    └── generate-traffic.sh    (basic load generator for testing/verifying metrics)
```

---

## Installation & Local Setup

Requires **Node.js 18+** and **npm**. Check your version first:

```bash
node -v
npm -v
```

### Option A — Run each service manually (recommended, so you understand what's running)

**Terminal 1 — Inventory Service:**

```bash
cd inventory-service
cp .env.example .env
npm install
npm start
```

You should see `Inventory service listening on port 3001`.

**Terminal 2 — Order Service:**

```bash
cd order-service
cp .env.example .env
npm install
npm start
```

You should see `Order service listening on port 3000`.

**Verify both are healthy:**

```bash
curl http://localhost:3001/health
curl http://localhost:3000/health
```

**Try placing an order (exercises both services):**

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"sku": "SKU-001", "quantity": 2, "customerId": "cust-1"}'
```

### Option B — Run both with Docker Compose

```bash
docker compose up --build
```

This starts both services on the same ports (3000 and 3001) and wires the `INVENTORY_SERVICE_URL` env var automatically so they can talk to each other.

### Generating traffic (for verifying your metrics/dashboard on Day 1)

```bash
chmod +x scripts/generate-traffic.sh
./scripts/generate-traffic.sh
```

This sends a mix of valid orders, invalid SKUs, and out-of-stock requests against `order-service` so you have both success and error traffic to see in your logs and metrics right away.

---

## Deploying to AWS

This starter code is a plain Node.js/Express app — deploy it the same way you'd deploy any Node app to **EC2** or **ECS**, per the main project spec. A few notes:

- Each service needs its own deployment target (two EC2 instances, or two ECS services/tasks). They are two independently deployable services by design.
- Set `INVENTORY_SERVICE_URL` on the order-service deployment to point at wherever inventory-service ends up running (its EC2 private IP/DNS, ECS service discovery name, or a load balancer in front of it).
- Both services expose `GET /health` — use it for your load balancer / target group health checks if you set one up.
- Nothing in this repo talks to CloudWatch yet. That's the instrumentation work you'll add per the CloudWatch Agent / SDK setup described in the main project docs.

---

## Where to Add Your Instrumentation Work

Both `server.js` files have `// TODO:` comments marking exactly where to add:

1. Correlation ID middleware (generate/read `X-Correlation-Id`, attach to `req`, pass it downstream on the inventory call)
2. Structured JSON logging (replace the placeholder `console.log` calls)
3. Custom metrics (order count, order value, error rate, latency, stock levels, etc. — see `INSTRUMENTATION.md` guidance in the main spec)

Start with correlation IDs first — the Team Addendum calls this out as the foundation everything else depends on.
