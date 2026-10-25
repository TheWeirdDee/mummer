/**
 * Shielded memo construction. The Zcash memo field is a fixed 512-byte
 * bound; limits here are enforced on UTF-8 BYTES, never characters.
 */

export const MEMO_MAX_BYTES = 512;
export const NOTE_MAX_BYTES = 400;

const encoder = new TextEncoder();

export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

export class MemoError extends Error {}

/**
 * Control characters other than newline, DEL, and the Unicode line/paragraph
 * separators (U+2028/U+2029) are not allowed in memos we build.
 */
function hasForbiddenCharacter(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c < 0x20 && c !== 0x0a) || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

export interface GiftMemoInput {
  /** Formatted gift reference, e.g. MUM-7Q4K-X2J9-PA3M-WV8T-C */
  reference: string;
  /** Optional free-text note from the giver. */
  note?: string;
}

/**
 * Build the memo text. The reference goes first so it appears in wallet
 * previews. Throws MemoError if the result would not fit 512 bytes.
 */
export function buildGiftMemo({ reference, note }: GiftMemoInput): string {
  if (!/^MUM-[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-HJKMNP-TV-Z]$/.test(reference)) {
    throw new MemoError('Invalid gift reference');
  }
  const trimmedNote = (note ?? '').replace(/\r\n?/g, '\n').trim();
  if (hasForbiddenCharacter(trimmedNote)) throw new MemoError('The note contains characters a memo cannot carry');
  if (utf8Length(trimmedNote) > NOTE_MAX_BYTES) throw new MemoError(`The note is longer than ${NOTE_MAX_BYTES} bytes`);
  const memo = trimmedNote.length > 0 ? `MUMMER ${reference}\n${trimmedNote}` : `MUMMER ${reference}`;
  if (utf8Length(memo) > MEMO_MAX_BYTES) throw new MemoError('The memo is longer than 512 bytes');
  return memo;
}

export function memoToBytes(memo: string): Uint8Array {
  const bytes = encoder.encode(memo);
  if (bytes.length > MEMO_MAX_BYTES) throw new MemoError('The memo is longer than 512 bytes');
  // A text memo's first byte must be <= 0xF4 (ZIP 302); valid UTF-8 text always satisfies this.
  return bytes;
}
