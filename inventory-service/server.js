require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// In-memory inventory store. Resets on restart - that's fine for this project.
// ---------------------------------------------------------------------------
const inventory = {
  'SKU-001': { sku: 'SKU-001', name: 'Wireless Mouse', stock: 50 },
  'SKU-002': { sku: 'SKU-002', name: 'Mechanical Keyboard', stock: 20 },
  'SKU-003': { sku: 'SKU-003', name: 'USB-C Hub', stock: 5 },
  'SKU-004': { sku: 'SKU-004', name: 'Webcam', stock: 0 }, // intentionally out of stock
};

// -----------------------------------------------------------------------
// TODO (Instrumentation - your project work, not provided here):
//
// 1. Correlation ID middleware
//    - Read the `X-Correlation-Id` header sent by order-service.
//    - Attach it to `req.correlationId` (or similar) so every log line
//      below can include it.
//    - If it's missing, generate one anyway so this service is still
//      traceable when called directly (e.g. crypto.randomUUID()).
//
// 2. Structured JSON logging
//    - Replace every `console.log(...)` below with a structured JSON log
//      line: { level, message, correlationId, sku, timestamp, ... }
//    - Use INFO for normal operations, WARN for handled edge cases
//      (e.g. insufficient stock), ERROR for unexpected failures.
//
// 3. Custom metrics (publish to CloudWatch)
//    - Suggested metrics for this service: reservation attempts/min,
//      reservation failures (out of stock) /min, current stock level
//      per SKU, reservation latency.
// -----------------------------------------------------------------------
app.use((req, res, next) => {
  // TODO: correlation ID middleware goes here
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'inventory-service' });
});

app.get('/inventory/:sku', (req, res) => {
  const item = inventory[req.params.sku];

  // TODO: replace with structured log
  console.log(`GET /inventory/${req.params.sku}`);

  if (!item) {
    return res.status(404).json({ error: 'SKU not found', sku: req.params.sku });
  }

  return res.status(200).json(item);
});

app.post('/inventory/reserve', (req, res) => {
  const { sku, quantity } = req.body || {};

  if (!sku || typeof quantity !== 'number' || quantity <= 0) {
    // TODO: replace with structured log (level: WARN)
    console.log('Invalid reservation request', req.body);
    return res.status(400).json({ error: 'sku and a positive numeric quantity are required' });
  }

  const item = inventory[sku];

  if (!item) {
    // TODO: replace with structured log (level: WARN)
    console.log(`Reservation failed - unknown SKU: ${sku}`);
    return res.status(404).json({ error: 'SKU not found', sku });
  }

  if (item.stock < quantity) {
    // TODO: replace with structured log (level: WARN)
    console.log(`Reservation failed - insufficient stock for ${sku} (have ${item.stock}, want ${quantity})`);
    return res.status(409).json({
      error: 'insufficient stock',
      sku,
      available: item.stock,
      requested: quantity,
    });
  }

  item.stock -= quantity;

  // TODO: replace with structured log (level: INFO)
  console.log(`Reserved ${quantity} of ${sku}, remaining stock: ${item.stock}`);

  return res.status(200).json({
    sku,
    reserved: quantity,
    remainingStock: item.stock,
  });
});

app.listen(PORT, () => {
  console.log(`Inventory service listening on port ${PORT}`);
});
