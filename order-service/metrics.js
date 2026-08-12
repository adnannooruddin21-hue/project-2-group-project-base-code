const dgram = require('dgram');

const STATSD_HOST = process.env.STATSD_HOST || 'localhost';
const STATSD_PORT = process.env.STATSD_PORT || 8125;
const socket = dgram.createSocket('udp4');

function formatTags(tags) {
  const entries = Object.entries(tags);
  if (entries.length === 0) return '';
  return '|#' + entries.map(([k, v]) => `${k}:${v}`).join(',');
}

function send(line) {
  const buf = Buffer.from(line);
  // Fire-and-forget over UDP - losing one data point is never worth
  // crashing or blocking a request for, so failures are just logged.
  socket.send(buf, 0, buf.length, STATSD_PORT, STATSD_HOST, (err) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', event: 'metric_send_failed', error: err.message }));
    }
  });
}

function increment(name, value = 1, tags = {}) {
  send(`${name}:${value}|c${formatTags(tags)}`);
}

function gauge(name, value, tags = {}) {
  send(`${name}:${value}|g${formatTags(tags)}`);
}

function timing(name, ms, tags = {}) {
  send(`${name}:${ms}|ms${formatTags(tags)}`);
}

module.exports = { increment, gauge, timing };
