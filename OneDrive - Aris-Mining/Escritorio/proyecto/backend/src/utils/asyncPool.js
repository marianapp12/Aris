/**
 * Ejecuta mapper(item, index) con como máximo `limit` tareas en vuelo.
 * El array de resultados conserva el mismo orden que `items`.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const n = Math.min(Math.max(1, Math.floor(limit)), items.length);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
