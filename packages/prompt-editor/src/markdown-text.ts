const MAX_CODE_POINT = 0x10ffff;
const MIN_SURROGATE = 0xd800;
const MAX_SURROGATE = 0xdfff;

const numericReference = /&#(?:[xX]([0-9a-fA-F]{1,7})|([0-9]{1,7}));/g;

/**
 * Decodes numeric character references the way a Markdown parser does. Values
 * outside Unicode, and surrogate code points, never throw: they keep the
 * source text or become the replacement character exactly as HTML parsing
 * defines. This runs on arbitrary user text, so it must be total.
 */
export function decodeNumericEntities(value: string): string {
  return value.replace(numericReference, (match, hex?: string, decimal?: string) => {
    const code = Number.parseInt(hex ?? decimal ?? "", hex === undefined ? 10 : 16);
    if (code > MAX_CODE_POINT) return match;
    if (code >= MIN_SURROGATE && code <= MAX_SURROGATE) return "\uFFFD";
    return String.fromCodePoint(code);
  });
}
