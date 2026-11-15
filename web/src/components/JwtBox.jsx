import React, { useState } from 'react';

// The raw token, education view (Rule 24 companion): a box big enough to read the
// whole JWT (wraps, no scroll cap) and a Copy button with visible feedback.
// The token passes through the lab's visible() guard discipline (it is mock-issued
// and labelled; Real mode never renders this pane — the token stays on the server).
export default function JwtBox({ value, testId = 'raw-token', label = 'The token as minted' }) {
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('Copied');
    } catch {
      // clipboard unavailable (permissions, non-secure context): select-the-text fallback
      const el = document.getElementById(`${testId}-text`);
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      setCopied('Select and copy');
    }
    setTimeout(() => setCopied(''), 2000);
  };
  return (
    <div data-testid={testId}>
      <div className="wi-jwt-bar">
        <button
          type="button"
          data-testid={`${testId}-copy`}
          onClick={copy}
          aria-label={`Copy the token to the clipboard`}
          className="wi-jwt-copy"
        >
          Copy
        </button>
        <span data-testid={`${testId}-copy-state`} className="wi-jwt-note">{copied}</span>
        <span className="wi-jwt-note wi-jwt-label">{label}</span>
      </div>
      <pre
        id={`${testId}-text`}
        data-testid={`${testId}-text`}
        className="wi-jwt-text"
      >
        {value}
      </pre>
    </div>
  );
}
