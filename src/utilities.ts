/**
 * Utility for de-circularizing objects with circular references
 */
export const ReplaceCircular = (val, cache?) => {

  cache = cache || new WeakSet();

  if (val && typeof val === 'object') {
    if (cache.has(val)) {
      return '[Circular]';
    }

    cache.add(val);

    const obj = Array.isArray(val) ? [] : {};
    for (const idx in val) {
      obj[idx] = ReplaceCircular(val[idx], cache);
    }

    cache.delete(val);
    return obj;
  }

  return val;
};