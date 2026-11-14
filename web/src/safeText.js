// visible(): control and bidi characters render as visible escapes (U+XXXX), never markup.
export function visible(text) {
  return String(text).replace(/[\u0000-\u0008\u000b-\u001f\u202a-\u202e\u2066-\u2069\u007f]/g,
    (c) => `‹U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}›`);
}
