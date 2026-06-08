/*
This file loads shared test setup for frontend unit tests.
Edit this file when all frontend tests need another shared setup step.
Copy the setup style here when you add another global frontend test helper.
*/

import "@testing-library/jest-dom/vitest";

const storage = new Map<string, string>();

Object.defineProperty(window, "localStorage", {
  value: {
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, String(value));
    },
  },
  configurable: true,
});
