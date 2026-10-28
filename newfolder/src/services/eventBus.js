'use strict';

/**
 * In-process event bus powering:
 *  - `GET /api/admin/stream` Server-Sent Events (live dashboard without polling),
 *  - the operator notification center,
 *  - the scheduler's alert fan-out.
 *
 * Design notes:
 *  - Zero dependencies, bounded memory (ring buffer of the last 250 events) so a
 *    forgotten browser tab can never grow the process.
 *  - `Last-Event-ID` replay means a brief reconnect never loses an incident.
 *  - Delivery is fire-and-forget and each subscriber is isolated: one broken socket
 *    cannot break an audit-critical write path.
 */

const MAX_BUFFER = 250;

const subscribers = new Set();
const buffer = [];
let seq = 0;
let bootedAt = new Date().toISOString();

function publish(type, payload = {}) {
  seq += 1;
  const event = {
    id: seq,
    type,
    at: new Date().toISOString(),
    payload,
  };
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);

  for (const sub of subscribers) {
    try {
      if (sub.filter && !sub.filter(event)) continue;
      sub.send(event);
    } catch {
      subscribers.delete(sub);
    }
  }
  return event;
}

function subscribe(send, { filter = null } = {}) {
  const sub = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, send, filter };
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

function replaySince(lastEventId) {
  const from = Number(lastEventId);
  if (!Number.isFinite(from)) return [];
  return buffer.filter((e) => e.id > from);
}

function stats() {
  return {
    bootedAt,
    published: seq,
    buffered: buffer.length,
    subscribers: subscribers.size,
    lastEventAt: buffer.length ? buffer[buffer.length - 1].at : null,
  };
}

function _resetForTests() {
  subscribers.clear();
  buffer.length = 0;
  seq = 0;
  bootedAt = new Date().toISOString();
}

module.exports = {
  publish,
  subscribe,
  replaySince,
  stats,
  _resetForTests,
};
