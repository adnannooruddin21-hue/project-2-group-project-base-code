require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { log } = require('./logger');
const metrics = require('./metrics');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// In-memory inventory store. Resets on restart - that's fine for this project.
// price is USD, used to compute order_value in order-service.
// ---------------------------------------------------------------------------
const inventory = {
  'SKU-001': { sku: 'SKU-001', name: 'Wireless Mouse', stock: 50, price: 19.99 },
  'SKU-002': { sku: 'SKU-002', name: 'Mechanical Keyboard', stock: 20, price: 79.99 },
  'SKU-003': { sku: 'SKU-003', name: 'USB-C Hub', stock: 5, price: 34.99 },
  'SKU-004': { sku: 'SKU-004', name: 'Webcam', stock: 0, price: 49.99 }, // intentionally out of stock
};

app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
});

// Access log: one line per request, level derived from status code.
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
  res.status(200).json({ status: 'ok', service: 'inventory-service' });
});

app.get('/inventory/:sku', (req, res) => {
  const item = inventory[req.params.sku];

  if (!item) {
    log('WARN', 'inventory_lookup_not_found', {
      correlationId: req.correlationId,
      sku: req.params.sku,
    });
    return res.status(404).json({ error: 'SKU not found', sku: req.params.sku });
  }

  log('INFO', 'inventory_lookup', {
    correlationId: req.correlationId,
    sku: item.sku,
    stock: item.stock,
  });

  return res.status(200).json(item);
});

app.post('/inventory/reserve', (req, res) => {
  const startedAt = process.hrtime.bigint();
  const { sku, quantity } = req.body || {};
  metrics.increment('reservation_attempts');

  const finishTiming = () => {
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.timing('reservation_latency', Math.round(latencyMs * 100) / 100);
  };

  if (!sku || typeof quantity !== 'number' || quantity <= 0) {
    log('WARN', 'reservation_validation_failed', {
      correlationId: req.correlationId,
      body: req.body,
    });
    metrics.increment('reservation_failures', 1, { reason: 'validation' });
    finishTiming();
    return res.status(400).json({ error: 'sku and a positive numeric quantity are required' });
  }

  const item = inventory[sku];

  if (!item) {
    log('WARN', 'reservation_failed_unknown_sku', {
      correlationId: req.correlationId,
      sku,
    });
    metrics.increment('reservation_failures', 1, { reason: 'unknown_sku' });
    finishTiming();
    return res.status(404).json({ error: 'SKU not found', sku });
  }

  if (item.stock < quantity) {
    log('WARN', 'reservation_failed_insufficient_stock', {
      correlationId: req.correlationId,
      sku,
      available: item.stock,
      requested: quantity,
    });
    metrics.increment('reservation_failures', 1, { reason: 'insufficient_stock', sku });
    finishTiming();
    return res.status(409).json({
      error: 'insufficient stock',
      sku,
      available: item.stock,
      requested: quantity,
    });
  }

  item.stock -= quantity;

  log('INFO', 'reservation_succeeded', {
    correlationId: req.correlationId,
    sku,
    quantity,
    remainingStock: item.stock,
  });
  metrics.gauge('stock_level', item.stock, { sku });
  finishTiming();

  return res.status(200).json({
    sku,
    reserved: quantity,
    remainingStock: item.stock,
    price: item.price,
  });
});

app.listen(PORT, () => {
  console.log(`Inventory service listening on port ${PORT}`);
});
