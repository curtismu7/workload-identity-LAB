import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; App's theme effect calls it
if (!window.matchMedia) {
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
}

// jsdom has no ResizeObserver; React Flow and the diagram kit's label layer need one (nothing is measured in jsdom).
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
