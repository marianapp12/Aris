/** Evita path traversal en nombres resultado-*.json (UUID v4 típico de la cola). */
export const QUEUE_REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidQueueRequestId(requestId) {
  return QUEUE_REQUEST_ID_RE.test(String(requestId ?? '').trim());
}
