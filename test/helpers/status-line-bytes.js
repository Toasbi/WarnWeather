// test/helpers/status-line-bytes.js
// Reads a packed status line (STATUS_LINE_n_UINT8) back into its slots, for the
// tests that assert on what an AppMessage carries.

/**
 * Decode one packed status line (STATUS_LINE_n_UINT8) into its three slots.
 *
 * @param {number[]} bytes The packed line.
 * @returns {Array<{kind: number, icon: number, text: string}>} The slots.
 */
function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3 && off < bytes.length; i += 1) {
    const len = bytes[off + 2];
    // Drop the control bytes packLine may append (the direction arrow's sentinel).
    const text = Buffer.from(bytes.slice(off + 3, off + 3 + len).filter((b) => b >= 0x20)).toString('utf8');
    slots.push({ kind: bytes[off], icon: bytes[off + 1], text: text });
    off += 3 + len;
  }
  return slots;
}

module.exports = { decodeLine };
