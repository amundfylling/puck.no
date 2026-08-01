/** Quote a CSV cell and force formula-looking user input to plain text. */
export function csvField(value: unknown): string {
  let text = String(value ?? '');
  // Excel can ignore leading whitespace/control characters before a formula.
  if (/^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]*[=+@-]/u.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
