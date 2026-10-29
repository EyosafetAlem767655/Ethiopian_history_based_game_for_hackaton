function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return (
    '{' +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
      .join(',') +
    '}'
  );
}
const jsonFields = new Set(['progress', 'payload', 'members', 'approvals', 'data']);
export function equivalentImportRow(
  table: string,
  keys: string[],
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  return keys.every((key) => {
    if (a[key] == null || b[key] == null) return a[key] == null && b[key] == null;
    if (jsonFields.has(key))
      try {
        return stable(JSON.parse(String(a[key]))) === stable(JSON.parse(String(b[key])));
      } catch {}
    if (table === 'results' && key === 'created') {
      const left = Date.parse(String(a[key])),
        right = Date.parse(String(b[key]));
      if (Number.isFinite(left) && Number.isFinite(right)) return left === right;
    }
    return String(a[key]) === String(b[key]);
  });
}
