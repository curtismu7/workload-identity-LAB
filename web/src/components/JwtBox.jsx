import React, { useState } from 'react';

// Split a JWT into its decoded header and payload (base64url -> JSON). Display only: nothing here verifies the signature.
function decodeJwt(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const dec = (seg) => {
      const b64 = seg.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(seg.length / 4) * 4, '=');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    return { header: dec(parts[0]), payload: dec(parts[1]), signature: parts[2] };
  } catch {
    return null;
  }
}

// The raw token, education view (Rule 24 companion): a box big enough to read the
// whole JWT (wraps, no scroll cap) and a Copy button with visible feedback.
// A Decode button flips the box between the raw token and its decoded header / payload / signature.
// The token passes through the lab's visible() guard discipline (it is mock-issued
// and labelled; Real mode renders this pane only when the server runs with WI_SHOW_REAL_TOKEN=1).
export default function JwtBox({ value, testId = 'raw-token', label = 'The token as minted' }) {
  const [copied, setCopied] = useState('');
  const [decoded, setDecoded] = useState(false);
  const parts = decodeJwt(value);
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
        {parts && (
          <button
            type="button"
            data-testid={`${testId}-decode`}
            onClick={() => setDecoded((d) => !d)}
            aria-pressed={decoded}
            className="wi-jwt-copy"
          >
            {decoded ? 'Show raw' : 'Decode'}
          </button>
        )}
        <span data-testid={`${testId}-copy-state`} className="wi-jwt-note">{copied}</span>
        <span className="wi-jwt-note wi-jwt-label">{label}</span>
      </div>
      {decoded && parts ? (
        <div data-testid={`${testId}-decoded`}>
          <div className="wi-jwt-note">Header</div>
          <pre className="wi-jwt-text" data-testid={`${testId}-decoded-header`}>{JSON.stringify(parts.header, null, 2)}</pre>
          <div className="wi-jwt-note" style={{ marginTop: 8 }}>Payload (claims)</div>
          <pre className="wi-jwt-text" data-testid={`${testId}-decoded-payload`}>{JSON.stringify(parts.payload, null, 2)}</pre>
          <div className="wi-jwt-note" style={{ marginTop: 8 }}>Signature (base64url; decoding does not verify it)</div>
          <pre className="wi-jwt-text" data-testid={`${testId}-decoded-signature`}>{parts.signature}</pre>
        </div>
      ) : (
        <pre
          id={`${testId}-text`}
          data-testid={`${testId}-text`}
          className="wi-jwt-text"
        >
          {value}
        </pre>
      )}
    </div>
  );
}
