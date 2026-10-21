import { MAX_MEDIA_BYTES } from "../../common/middleware/upload.middleware";
import { MAX_PAGE_SIZE } from "../../common/pagination";
import { MAX_SYNC_BATCH_INVOICES } from "../invoice/invoice.constants";
import { MAX_LINE_ITEMS, MAX_LINE_VALUES_BYTES, MAX_VALUES_BYTES } from "../../fields/values";
import { config } from "../../config/env";
import { LEGAL_CONTACT_EMAIL, LEGAL_PATHS } from "../legal/legal.view";
import { RemoteConfig } from "./dto/remoteConfig.dto";

// Bump when a key is REMOVED or RENAMED (an old build may depend on it). Adding keys: no bump.
export const SCHEMA_VERSION = 1;

// How long the app may use a fetched config before asking again. It also re-fetches on every
// cold start, so a flipped switch reaches everyone within about an hour or one app restart.
export const TTL_SECONDS = 60 * 60;

// THE default config — what every app gets today. Where the server already has a constant for
// a value (upload cap, sync batch cap, page size, legal paths + contact) it is IMPORTED, not retyped, so
// the number the app checks cannot drift from the number the server enforces.
//
// To change a value for everyone: edit here, deploy. To change it WITHOUT a deploy: set
// REMOTE_CONFIG_OVERRIDES in the server's .env (a JSON patch of this shape) and recreate the
// container — see docs/REMOTE_CONFIG.md. Per-version / per-user variations belong in
// remoteConfig.rules.ts, not here.
export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  features: {
    googleLogin: true,
    cloudSync: true,
    templateStore: true,
    premiumTemplates: true,
    productCatalogue: true,
    mediaUpload: true,
  },
  update: {
    minSupportedBuild: 0,
    recommendedBuild: 0,
    // TODO: fill in once the store listing exists
    // (Play: https://play.google.com/store/apps/details?id=<applicationId>).
    androidStoreUrl: null,
    iosStoreUrl: null,
    message: null,
  },
  maintenance: {
    enabled: false,
    message: null,
  },
  limits: {
    maxMediaBytes: MAX_MEDIA_BYTES,
    maxSyncBatchInvoices: MAX_SYNC_BATCH_INVOICES,
    maxPageSize: MAX_PAGE_SIZE,
    maxValuesBytes: MAX_VALUES_BYTES,
    maxLineValuesBytes: MAX_LINE_VALUES_BYTES,
    maxLineItems: MAX_LINE_ITEMS,
  },
  // HOA protocol 12: absolute URLs on the one public origin (APP_PUBLIC_URL) + the legal module's
  // own paths, and the contact address imported from the module that renders it — so a link and
  // the page it points at can never disagree.
  links: {
    privacyPolicy: `${config.publicUrl}${LEGAL_PATHS.privacy}`,
    terms: `${config.publicUrl}${LEGAL_PATHS.terms}`,
    deleteAccount: `${config.publicUrl}${LEGAL_PATHS.deleteAccount}`,
    supportEmail: LEGAL_CONTACT_EMAIL,
  },
};
