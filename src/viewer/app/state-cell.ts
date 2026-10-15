/**
 * Minimal observable state cell, backwards-compatible with the project's
 * historical `{ value: ... }` mutable-container convention.
 *
 * Reads and writes look identical to the old plain-object cells
 * (`cell.value = x`), so existing code keeps working unchanged. On top of
 * that, `subscribe` lets consumers react to writes instead of re-reading
 * state after every event.
 */
export interface StateCell<T> {
  value: T;
  subscribe(listener: (value: T) => void): () => void;
}

export function createStateCell<T>(initialValue: T): StateCell<T> {
  let current = initialValue;
  const listeners = new Set<(value: T) => void>();
  const cell = {} as StateCell<T>;
  Object.defineProperty(cell, "value", {
    get: () => current,
    set: (next: T) => {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
    enumerable: true,
    configurable: true,
  });
  cell.subscribe = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return cell;
}
