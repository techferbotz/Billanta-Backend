import { Customer } from "@prisma/client";
import { optionalString, optionalStateCode, requireString } from "../../../common/validation";
import { normalizeOptionalGstin, reconcileStateCode } from "../../../common/gstin";

/// A customer as clients see them.
export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

/// Full write payload for POST (create or, on a repeated id, full replace). Optional
/// fields are `string | null`: POST carries the complete customer, so an omitted field is
/// stored as null — the same full-replace contract as Company.
export interface CustomerWriteData {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  country: string | null;
}

/// Partial payload for PATCH. Only keys the client actually sent appear, so an absent key
/// leaves that column unchanged while an explicit null clears it. This is the one place
/// the customer contract is a merge rather than a replace, matching the PATCH verb.
export type CustomerPatchData = Partial<CustomerWriteData>;

export const toCustomerDto = (c: Customer): CustomerDto => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  gstin: c.gstin,
  addressLine1: c.addressLine1,
  addressLine2: c.addressLine2,
  city: c.city,
  state: c.state,
  stateCode: c.stateCode,
  pincode: c.pincode,
  country: c.country,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const orNull = (v: string | null | undefined): string | null => (v === undefined ? null : v);

// Validate the gstin/stateCode pair. reconcileStateCode makes the GSTIN authoritative:
// stateCode is derived from it when omitted and rejected when it contradicts the GSTIN, so
// the stored pair can never disagree.
const gstinAndState = (
  body: Record<string, unknown>
): { gstin: string | null | undefined; stateCode: string | null | undefined } => {
  const gstin = normalizeOptionalGstin(body.gstin, "gstin");
  const stateCode = reconcileStateCode(gstin, optionalStateCode(body.stateCode, "stateCode"));
  return { gstin, stateCode };
};

// Full-replace parse for POST /customers.
export const parseCreateCustomerBody = (body: Record<string, unknown>): CustomerWriteData => {
  const { gstin, stateCode } = gstinAndState(body);
  return {
    name: requireString(body.name, "name", 200),
    phone: orNull(optionalString(body.phone, "phone", 40)),
    email: orNull(optionalString(body.email, "email", 200)),
    gstin: orNull(gstin),
    addressLine1: orNull(optionalString(body.addressLine1, "addressLine1", 300)),
    addressLine2: orNull(optionalString(body.addressLine2, "addressLine2", 300)),
    city: orNull(optionalString(body.city, "city", 120)),
    state: orNull(optionalString(body.state, "state", 120)),
    stateCode: orNull(stateCode),
    pincode: orNull(optionalString(body.pincode, "pincode", 20)),
    country: orNull(optionalString(body.country, "country", 120)),
  };
};

// Partial parse for PATCH /customers/:id — only sets keys the client sent.
export const parsePatchCustomerBody = (body: Record<string, unknown>): CustomerPatchData => {
  const data: CustomerPatchData = {};

  if ("name" in body) data.name = requireString(body.name, "name", 200);
  if ("phone" in body) data.phone = optionalString(body.phone, "phone", 40) ?? null;
  if ("email" in body) data.email = optionalString(body.email, "email", 200) ?? null;
  if ("addressLine1" in body)
    data.addressLine1 = optionalString(body.addressLine1, "addressLine1", 300) ?? null;
  if ("addressLine2" in body)
    data.addressLine2 = optionalString(body.addressLine2, "addressLine2", 300) ?? null;
  if ("city" in body) data.city = optionalString(body.city, "city", 120) ?? null;
  if ("state" in body) data.state = optionalString(body.state, "state", 120) ?? null;
  if ("pincode" in body) data.pincode = optionalString(body.pincode, "pincode", 20) ?? null;
  if ("country" in body) data.country = optionalString(body.country, "country", 120) ?? null;

  // gstin/stateCode are parsed but NOT cross-reconciled here: a PATCH may set stateCode
  // alone while leaving an existing GSTIN in place, and only the service (which can read the
  // existing row) can reconcile the two authoritatively. We just validate each field's shape.
  if ("gstin" in body) data.gstin = normalizeOptionalGstin(body.gstin, "gstin") ?? null;
  if ("stateCode" in body) data.stateCode = optionalStateCode(body.stateCode, "stateCode") ?? null;

  return data;
};
