require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { log } = require('./logger');

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
// 3. Custom metrics (publish to CloudWatch)
//    - Suggested metrics for this service: orders created/min, order
//      value ($), order failure rate, end-to-end order latency
//      (including the call to inventory-service).
// -----------------------------------------------------------------------
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
});

// Access log: one line per request, level derived from status code.
// This is the line CloudWatch Logs Insights queries for request rate,
// error rate, and latency (the Golden Signals) will read.
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    log(level, 'request_completed', {
      correlationId: req.correlationId,
      method: req.method,
      endpoint: req.path,
      statusCode: res.statusCode,
      latencyMs: Math.round(latencyMs * 100) / 100,
    });
  });
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'order-service' });
});

app.post('/orders', async (req, res) => {
  const { sku, quantity, customerId } = req.body || {};

  if (!sku || typeof quantity !== 'number' || quantity <= 0 || !customerId) {
    log('WARN', 'order_validation_failed', {
      correlationId: req.correlationId,
      body: req.body,
    });
    return res.status(400).json({ error: 'sku, quantity (positive number), and customerId are required' });
  }

  try {
    const reservation = await axios.post(`${INVENTORY_SERVICE_URL}/inventory/reserve`, {
      sku,
      quantity,
    }, {
      headers: { 'X-Correlation-Id': req.correlationId },
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

    log('INFO', 'order_created', {
      correlationId: req.correlationId,
      orderId: order.id,
      customerId,
      sku,
      quantity,
      remainingStock: order.remainingStock,
    });

    return res.status(201).json(order);
  } catch (err) {
    if (err.response) {
      // Inventory service responded, but rejected the reservation
      // (e.g. 409 insufficient stock, 404 unknown SKU)
      log('WARN', 'order_rejected', {
        correlationId: req.correlationId,
        customerId,
        sku,
        quantity,
        reason: err.response.data?.error,
        inventoryStatus: err.response.status,
      });
      return res.status(err.response.status).json({
        error: 'order could not be fulfilled',
        reason: err.response.data?.error,
      });
    }

    // Inventory service unreachable / timed out / unexpected error
    log('ERROR', 'inventory_service_unreachable', {
      correlationId: req.correlationId,
      customerId,
      sku,
      errorMessage: err.message,
    });
    return res.status(502).json({ error: 'inventory service unavailable' });
  }
});

app.get('/orders/:id', (req, res) => {
  const order = orders[req.params.id];

  if (!order) {
    log('WARN', 'order_not_found', {
      correlationId: req.correlationId,
      orderId: req.params.id,
    });
    return res.status(404).json({ error: 'order not found', id: req.params.id });
  }

  log('INFO', 'order_retrieved', {
    correlationId: req.correlationId,
    orderId: order.id,
  });

  return res.status(200).json(order);
});

app.listen(PORT, () => {
  console.log(`Order service listening on port ${PORT}`);
  console.log(`Talking to inventory-service at ${INVENTORY_SERVICE_URL}`);
});
