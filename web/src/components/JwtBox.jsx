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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <button
          type="button"
          data-testid={`${testId}-copy`}
          onClick={copy}
          aria-label={`Copy the token to the clipboard`}
          style={{ font: 'inherit', fontSize: 11, padding: '2px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border, #d8dde3)', background: 'var(--surface-2, #eff0f1)', color: 'inherit' }}
        >
          Copy
        </button>
        <span data-testid={`${testId}-copy-state`} style={{ fontSize: 11, opacity: 0.75, minHeight: '1em' }}>{copied}</span>
        <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>{label}</span>
      </div>
      <pre
        id={`${testId}-text`}
        data-testid={`${testId}-text`}
        style={{
          margin: 0, padding: '12px 14px', borderRadius: 8,
          background: 'var(--surface-2, #eff0f1)', color: 'var(--text, inherit)',
          border: '1px solid var(--border, #d8dde3)',
          fontFamily: '"IBM Plex Mono",ui-monospace,monospace', fontSize: 12, lineHeight: 1.6,
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'visible',
          minHeight: '6em',
        }}
      >
        {value}
      </pre>
    </div>
  );
}
