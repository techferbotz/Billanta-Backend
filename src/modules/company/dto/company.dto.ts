import { Company } from "@prisma/client";
import { optionalString, optionalStateCode, requireString } from "../../../common/validation";
import { normalizeOptionalGstin, reconcileStateCode } from "../../../common/gstin";

/// The seller profile as clients see it.
export interface CompanyDto {
  id: string;
  name: string;
  logoUrl: string | null;
  logoThumbnailUrl: string | null;
  gstin: string | null;
  stateCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  signatureUrl: string | null;
  upiId: string | null;
  qrImageUrl: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  createdAt: string;
  updatedAt: string;
}

/// The full column set (minus id/userId/timestamps) written by an upsert. Every optional
/// field is `string | null` rather than `| undefined`, because PUT is a FULL REPLACE:
/// parsing coerces an omitted field to null so the stored profile always matches exactly
/// what the client sent.
export interface CompanyWriteData {
  name: string;
  logoUrl: string | null;
  logoThumbnailUrl: string | null;
  gstin: string | null;
  stateCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  signatureUrl: string | null;
  upiId: string | null;
  qrImageUrl: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
}

export const toCompanyDto = (c: Company): CompanyDto => ({
  id: c.id,
  name: c.name,
  logoUrl: c.logoUrl,
  logoThumbnailUrl: c.logoThumbnailUrl,
  gstin: c.gstin,
  stateCode: c.stateCode,
  addressLine1: c.addressLine1,
  addressLine2: c.addressLine2,
  city: c.city,
  state: c.state,
  pincode: c.pincode,
  country: c.country,
  phone: c.phone,
  email: c.email,
  signatureUrl: c.signatureUrl,
  upiId: c.upiId,
  qrImageUrl: c.qrImageUrl,
  bankName: c.bankName,
  bankAccountNumber: c.bankAccountNumber,
  bankIfsc: c.bankIfsc,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

// undefined -> null for a full-replace PUT.
const orNull = (v: string | null | undefined): string | null => (v === undefined ? null : v);

/**
 * Parse and validate a PUT /company body into the full write payload.
 *
 * PUT replaces the entire profile, so an omitted optional field becomes null (cleared).
 * The Android client holds the whole company locally and sends it in full, so this is the
 * natural contract; it also means the stored row can never drift into a half-updated state.
 *
 * `gstin` is checksum-validated; `stateCode` is bounded 01-38. `reconcileStateCode` makes
 * the GSTIN authoritative: a stateCode is derived from it when omitted and REJECTED when it
 * contradicts the GSTIN, so the stored pair can never disagree.
 */
export const parseCompanyBody = (body: Record<string, unknown>): CompanyWriteData => {
  const gstin = orNull(normalizeOptionalGstin(body.gstin, "gstin"));
  const stateCode = orNull(reconcileStateCode(gstin, optionalStateCode(body.stateCode, "stateCode")));

  return {
    name: requireString(body.name, "name", 200),
    logoUrl: orNull(optionalString(body.logoUrl, "logoUrl", 1000)),
    logoThumbnailUrl: orNull(optionalString(body.logoThumbnailUrl, "logoThumbnailUrl", 1000)),
    gstin,
    stateCode,
    addressLine1: orNull(optionalString(body.addressLine1, "addressLine1", 300)),
    addressLine2: orNull(optionalString(body.addressLine2, "addressLine2", 300)),
    city: orNull(optionalString(body.city, "city", 120)),
    state: orNull(optionalString(body.state, "state", 120)),
    pincode: orNull(optionalString(body.pincode, "pincode", 20)),
    country: orNull(optionalString(body.country, "country", 120)) ?? "India",
    phone: orNull(optionalString(body.phone, "phone", 40)),
    email: orNull(optionalString(body.email, "email", 200)),
    signatureUrl: orNull(optionalString(body.signatureUrl, "signatureUrl", 1000)),
    upiId: orNull(optionalString(body.upiId, "upiId", 200)),
    qrImageUrl: orNull(optionalString(body.qrImageUrl, "qrImageUrl", 1000)),
    bankName: orNull(optionalString(body.bankName, "bankName", 200)),
    bankAccountNumber: orNull(optionalString(body.bankAccountNumber, "bankAccountNumber", 60)),
    bankIfsc: orNull(optionalString(body.bankIfsc, "bankIfsc", 20)),
  };
};
