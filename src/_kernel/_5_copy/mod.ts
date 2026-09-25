// Bun 1.3.11 structuredClone misindexes shared object references after BigInts.
// Domain values are plain records/arrays, so clone them without runtime codecs.
export function copyValue<T>(value: T): T {
  const copies = new Map<object, object>(), active = new Set<object>();
  function copy(item: unknown): unknown {
    if (item === null || item === undefined || ["string", "number", "boolean", "bigint"].includes(typeof item)) return item;
    if (typeof item !== "object") throw new Error("Unsupported domain value");
    if (active.has(item)) throw new Error("Cyclic domain value");
    const previous = copies.get(item); if (previous !== undefined) return previous;
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new Error("Unsupported domain object");
    const result: Record<string, unknown> | unknown[] = Array.isArray(item) ? [] : Object.create(prototype);
    copies.set(item, result); active.add(item);
    for (const [key, child] of Object.entries(item)) {
      Object.defineProperty(result, key, { value: copy(child), writable: true, enumerable: true, configurable: true });
    }
    active.delete(item); return result;
  }
  return copy(value) as T;
}
