require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001';

// ---------------------------------------------------------------------------
// In-memory order store. Resets on restart - that's fine for this project.
// ---------------------------------------------------------------------------
const orders = {};
let nextOrderId = 1;

// -----------------------------------------------------------------------
// TODO (Instrumentation - your project work, not provided here):
//
// 1. Correlation ID middleware
//    - This is the START of the request chain, so THIS service generates
//      the correlation ID if the caller didn't already supply one via
//      `X-Correlation-Id`.
//    - Attach it to `req.correlationId`.
//    - Forward it as an `X-Correlation-Id` header on the axios call to
//      inventory-service below (see the TODO in the /orders handler).
//
// 2. Structured JSON logging
//    - Replace every `console.log(...)` below with a structured JSON log
//      line: { level, message, correlationId, orderId, timestamp, ... }
//    - Use INFO for normal operations, WARN for handled edge cases
//      (e.g. inventory rejected the reservation), ERROR for unexpected
//      failures (e.g. inventory-service unreachable).
//
// 3. Custom metrics (publish to CloudWatch)
//    - Suggested metrics for this service: orders created/min, order
//      value ($), order failure rate, end-to-end order latency
//      (including the call to inventory-service).
// -----------------------------------------------------------------------
app.use((req, res, next) => {
  // TODO: correlation ID middleware goes here
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'order-service' });
});

app.post('/orders', async (req, res) => {
  const { sku, quantity, customerId } = req.body || {};

  if (!sku || typeof quantity !== 'number' || quantity <= 0 || !customerId) {
    // TODO: replace with structured log (level: WARN)
    console.log('Invalid order request', req.body);
    return res.status(400).json({ error: 'sku, quantity (positive number), and customerId are required' });
  }

  try {
    // TODO: forward the correlation ID here, e.g.
    //   headers: { 'X-Correlation-Id': req.correlationId }
    const reservation = await axios.post(`${INVENTORY_SERVICE_URL}/inventory/reserve`, {
      sku,
      quantity,
    });

    const order = {
      id: nextOrderId++,
      sku,
      quantity,
      customerId,
      status: 'confirmed',
      remainingStock: reservation.data.remainingStock,
      createdAt: new Date().toISOString(),
    };
    orders[order.id] = order;

    // TODO: replace with structured log (level: INFO)
    console.log(`Order ${order.id} confirmed for ${customerId}: ${quantity}x ${sku}`);

    return res.status(201).json(order);
  } catch (err) {
    if (err.response) {
      // Inventory service responded, but rejected the reservation
      // (e.g. 409 insufficient stock, 404 unknown SKU)
      // TODO: replace with structured log (level: WARN)
      console.log(`Order rejected for ${customerId}: ${err.response.data?.error}`);
      return res.status(err.response.status).json({
        error: 'order could not be fulfilled',
        reason: err.response.data?.error,
      });
    }

    // Inventory service unreachable / timed out / unexpected error
    // TODO: replace with structured log (level: ERROR)
    console.log('Failed to reach inventory-service', err.message);
    return res.status(502).json({ error: 'inventory service unavailable' });
  }
});

app.get('/orders/:id', (req, res) => {
  const order = orders[req.params.id];

  // TODO: replace with structured log
  console.log(`GET /orders/${req.params.id}`);

  if (!order) {
    return res.status(404).json({ error: 'order not found', id: req.params.id });
  }

  return res.status(200).json(order);
});

app.listen(PORT, () => {
  console.log(`Order service listening on port ${PORT}`);
  console.log(`Talking to inventory-service at ${INVENTORY_SERVICE_URL}`);
});
