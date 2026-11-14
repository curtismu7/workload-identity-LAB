import React, { useEffect, useState } from 'react';

// Colored, theme-aware JSON viewer with raw/colored toggle (standalone UI standard:
// theme tokens only, dark and light, visible borders, copy-friendly).
// Color choices are per-token fixed hues with light/dark variants so both themes
// hit 4.5:1 on their background.

const PALETTE = {
  light: {
    key: '#8a1538',      // deep raspberry on white
    string: '#1e6b34',   // green
    number: '#8a4b00',   // amber-brown
    boolTrue: '#0e6a6a', // teal
    boolFalse: '#a12622',// red
    nullLit: '#5b6770',  // grey
    punct: '#556070',
    bg: '#f7f8f9',
    border: '#d8dde3',
  },
  dark: {
    key: '#f0a5b8',
    string: '#8ee2a4',
    number: '#f2c078',
    boolTrue: '#7fd8d8',
    boolFalse: '#f2a09e',
    nullLit: '#9aa7b3',
    punct: '#9aa7b3',
    bg: '#14181c',
    border: '#3a444e',
  },
};

function colorize(value, pal) {
  if (value === null) return <span style={{ color: pal.nullLit }}>null</span>;
  if (typeof value === 'string') return <span style={{ color: pal.string }}>"{value}"</span>;
  if (typeof value === 'number') return <span style={{ color: pal.number }}>{String(value)}</span>;
  if (typeof value === 'boolean') return <span style={{ color: value ? pal.boolTrue : pal.boolFalse }}>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: pal.punct }}>[]</span>;
    return (
      <span>
        <span style={{ color: pal.punct }}>[</span>
        {value.map((v, i) => (
          <span key={i}>
            <div style={{ marginLeft: 14 }}>{colorize(v, pal)}{i < value.length - 1 && <span style={{ color: pal.punct }}>,</span>}</div>
          </span>
        ))}
        <span style={{ color: pal.punct }}>]</span>
      </span>
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return <span style={{ color: pal.punct }}>{'{}'}</span>;
  return (
    <span>
      <span style={{ color: pal.punct }}>{"{"}</span>
      {keys.map((k, i) => (
        <span key={k}>
          <div style={{ marginLeft: 14 }}>
            <span style={{ color: pal.key }}>"{k}"</span>
            <span style={{ color: pal.punct }}>: </span>
            {colorize(value[k], pal)}
            {i < keys.length - 1 && <span style={{ color: pal.punct }}>,</span>}
          </div>
        </span>
      ))}
      <span style={{ color: pal.punct }}>{"}"}</span>
    </span>
  );
}

export default function JsonView({ data, testid = 'json-view', label = 'JSON' }) {
  const [colored, setColored] = useState(true);
  const [theme, setTheme] = useState(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return setTheme(attr);
      setTheme(window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', read);
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', read); };
  }, []);
  const pal = PALETTE[theme] || PALETTE.light;

  return (
    <div data-testid={testid}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <button
          type="button"
          data-testid={`${testid}-toggle`}
          onClick={() => setColored(c => !c)}
          aria-pressed={colored}
          style={{
            font: 'inherit', fontSize: 11, padding: '2px 10px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${pal.border}`, background: colored ? pal.key : 'transparent',
            color: colored ? '#fff' : 'inherit',
          }}
        >
          {colored ? 'Colored' : 'Raw'}
        </button>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{label}</span>
      </div>
      <pre
        data-testid={`${testid}-pre`}
        style={{ margin: 0, padding: 10, borderRadius: 8, overflowX: 'auto', fontSize: 12, lineHeight: 1.5, background: pal.bg, border: `1px solid ${pal.border}` }}
      >
        {colored ? colorize(data, pal) : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
