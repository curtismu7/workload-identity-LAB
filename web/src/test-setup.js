import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; App's theme effect calls it
if (!window.matchMedia) {
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
}
