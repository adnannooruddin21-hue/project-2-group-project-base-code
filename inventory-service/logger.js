const SERVICE_NAME = 'inventory-service';

function log(level, event, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    event,
    ...fields,
  }));
}

module.exports = { log };
