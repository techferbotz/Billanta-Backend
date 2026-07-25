import { BadRequestError } from "./errors/AppError";

// GSTIN (Goods & Services Tax Identification Number) validation.
//
// A GSTIN is 15 characters, laid out as:
//   [2] state code   e.g. 27 (Maharashtra)
//   [10] PAN         5 letters, 4 digits, 1 letter
//   [1] entity code  1-9 or A-Z (nth registration of this PAN in the state)
//   [1] 'Z'          a fixed literal in the standard scheme
//   [1] checksum     0-9 or A-Z, derived from the first 14 characters
//
// We validate BOTH the shape and the checksum. The checksum matters: a mistyped digit
// that still fits the shape (very common when a user types their own GSTIN) is caught
// only by recomputing the check character. Getting this wrong on an invoice is a real
// problem — a buyer can't claim input tax credit against a malformed seller GSTIN.

// Structural shape. The leading state code is bounded to the ASSIGNED range 01-38:
// `(0[1-9]|[12][0-9]|3[0-8])` accepts 01-38 and rejects 00 and 39+, so a GSTIN whose
// embedded state code is out of range is refused up front (a plain `[0-3][0-9]` would let
// "00…" and "39…" through and only the checksum would catch some of them — see the
// state-code review finding).
const GSTIN_SHAPE =
  /^(0[1-9]|[12][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// The 36-symbol alphabet GST uses: 0-9 then A-Z, so a char's value is its index here.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Compute the GSTIN check character for the first 14 characters.
 *
 * The official algorithm (GSTN spec): walk the 14 characters, multiply each code point by
 * an alternating factor (2,1,2,1,… from the RIGHTMOST), fold the product into base 36
 * (quotient + remainder), sum, and the check char is whatever makes the total a multiple
 * of 36.
 */
const gstinCheckChar = (first14: string): string => {
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(first14[i]);
    let addend = factor * codePoint;
    addend = Math.floor(addend / 36) + (addend % 36);
    sum += addend;
    factor = factor === 2 ? 1 : 2;
  }
  const checkCodePoint = (36 - (sum % 36)) % 36;
  return ALPHABET[checkCodePoint];
};

// True if `value` is a structurally valid GSTIN with a correct checksum.
export const isValidGstin = (value: string): boolean => {
  const gstin = value.toUpperCase();
  if (!GSTIN_SHAPE.test(gstin)) return false;
  return gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
};

// The 2-digit state code embedded in a GSTIN — the seller/buyer comparison that decides
// the CGST+SGST vs IGST split in Phase 5.
export const stateCodeFromGstin = (gstin: string): string => gstin.slice(0, 2);

/**
 * Reconcile a (normalized) GSTIN with a separately-supplied stateCode into the ONE value
 * to store, so the two can genuinely never disagree in the database.
 *
 * The GSTIN is authoritative: its first two digits ARE the state code. So:
 *   - GSTIN present, stateCode absent/null  -> derive stateCode from the GSTIN.
 *   - GSTIN present, stateCode present but different -> reject (a contradictory payload).
 *   - GSTIN present, stateCode present and equal -> keep it.
 *   - GSTIN absent -> pass the stateCode through unchanged.
 *
 * Without this a client could POST {gstin: "27…"(Maharashtra), stateCode: "29"(Karnataka)}
 * and both would be stored verbatim, and the Phase 5 tax split would read whichever field a
 * given code path happened to use — one of them always wrong.
 */
export const reconcileStateCode = (
  gstin: string | null | undefined,
  stateCode: string | null | undefined
): string | null | undefined => {
  if (!gstin) return stateCode;
  const derived = gstin.slice(0, 2);
  if (stateCode === undefined || stateCode === null) return derived;
  if (stateCode !== derived) {
    throw new BadRequestError(
      `"stateCode" (${stateCode}) does not match the state code in the GSTIN (${derived})`
    );
  }
  return derived;
};

/**
 * Validate an optional GSTIN field and return it normalized (upper-cased), or the value
 * unchanged when it's null/undefined.
 *
 * Normalizing to upper case here means the split logic and the printed invoice always see
 * the canonical form, regardless of how the user typed it.
 */
export const normalizeOptionalGstin = (
  value: unknown,
  field = "gstin"
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestError(`"${field}" must be a string or null`);
  }
  const gstin = value.trim().toUpperCase();
  if (gstin.length === 0) return null;
  if (!isValidGstin(gstin)) {
    throw new BadRequestError(
      `"${field}" is not a valid GSTIN (expected 15 characters like 27AAPFU0939F1ZV)`
    );
  }
  return gstin;
};
