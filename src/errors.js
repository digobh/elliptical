// Some browsers (e.g. Bluefy on iOS) reject with plain strings, objects or
// nothing at all. Turn whatever we get into something readable.
export function describeError(e) {
  if (e == null) return `empty rejection (${e === null ? 'null' : 'undefined'})`;
  if (typeof e !== 'object') return `${String(e)} (${typeof e})`;
  const parts = [];
  if (e.name) parts.push(e.name);
  if (e.message) parts.push(e.message);
  if (!e.message && e.code != null) parts.push(`code ${e.code}`);
  if (parts.length) return parts.join(': ');
  try { return JSON.stringify(e); } catch { return String(e); }
}
