import { DeepPartial } from "../../../common/deepMerge";

// ---------------------------------------------------------------------------
// The remote config document — the JSON the app reads at launch to decide how to behave.
// HOA protocol 10 (remote config, backend): the four sections `features` / `update` /
// `maintenance` / `links` are UNIVERSAL across every House of Apps backend and must keep
// these exact shapes, because one shared client implementation consumes them. `limits` is
// Billanta's own section.
//
// RULES FOR THIS SHAPE (they are what let it evolve without an app release):
//   - Every value is a JSON primitive, a nested object of them, or an array. No dates (use ISO
//     strings), no undefined (use null for "not set").
//   - ADDING a key is always safe: clients ignore keys they don't know and use their own
//     compiled-in default for keys that are missing. REMOVING or RENAMING a key breaks old
//     builds — bump SCHEMA_VERSION (remoteConfig.defaults.ts) and prefer adding a new key.
//   - Defaults equal today's behaviour, so an app that starts honouring the config changes
//     nothing until we deliberately flip a value.
// ---------------------------------------------------------------------------
export interface RemoteConfig {
  // Kill switches. `false` hides/disables that entry point in the app. The API route itself
  // stays up — these are client-side gates for incidents and staged rollouts. Billanta is
  // offline-first, so every one of these can be turned off without breaking the core promise:
  // creating, rendering and sharing an invoice keeps working with no network at all.
  features: {
    googleLogin: boolean; // the "Sign in with Google" entry point (POST /auth/google)
    cloudSync: boolean; // backup/restore + POST /invoices/sync — pause syncing app-wide
    templateStore: boolean; // browsing/downloading templates (GET /templates); cached ones still render
    premiumTemplates: boolean; // the premium-template / upgrade UI (templates flagged isPremium)
    productCatalogue: boolean; // the reusable line-item catalogue (/products)
    mediaUpload: boolean; // logo / signature / QR image upload (POST /media -> S3)
  };
  // App update policy. The client compares its own integer BUILD number (the X-App-Build it
  // sends) — never the display version string, which does not sort reliably. 0 = no requirement.
  update: {
    minSupportedBuild: number; // below this: hard block, "update to continue"
    recommendedBuild: number; // below this: dismissible "update available" nudge
    androidStoreUrl: string | null;
    iosStoreUrl: string | null;
    message: string | null; // optional copy for either prompt
  };
  // Emergency switch: the app shows `message` instead of loading.
  maintenance: {
    enabled: boolean;
    message: string | null;
  };
  // Caps the client should respect BEFORE calling the API, so a doomed request is never sent.
  // The SERVER enforces all of them; they are mirrored here from the same constants, never
  // retyped, so the number the app checks cannot drift from the number the server enforces.
  limits: {
    maxMediaBytes: number; // per image on POST /media (upload.middleware)
    maxSyncBatchInvoices: number; // invoices per POST /invoices/sync push (invoice.constants)
    maxPageSize: number; // the ceiling on ?limit for every list endpoint (pagination)
    maxValuesBytes: number; // one record's `values` map, as JSON (fields/values.ts)
    maxLineValuesBytes: number; // one line item's `values` map, as JSON (fields/values.ts)
    maxLineItems: number; // lines on one invoice (fields/values.ts)
  };
  // Absolute URLs, so the app never hard-codes the API host for these.
  links: {
    privacyPolicy: string;
    terms: string;
    deleteAccount: string;
    supportEmail: string;
  };
}

// What GET /config returns (inside the standard envelope's `data`).
export interface RemoteConfigDto {
  schemaVersion: number; // bumped when keys are removed/renamed (additions do not bump it)
  variant: string; // "default", or "default+<ruleId>+..." for each targeting rule that applied
  revision: string; // fingerprint of `config` — changes whenever any value changes
  ttlSeconds: number; // re-fetch after this many seconds (and on every cold start)
  config: RemoteConfig;
}

// Who is asking. This is the targeting input for future rules — per-version, per-platform,
// per-install experiments (hash deviceId into buckets), per-user overrides. Every field comes
// from an OPTIONAL header (see remoteConfig.context.ts); a client that sends none still gets
// the default config.
export type Platform = "android" | "ios" | "web" | "unknown";

export interface ConfigContext {
  // The app's stable per-install id, from X-Device-Id. Billanta has no device concept in its
  // data model (ownership is by userId and nothing else — see types/express.d.ts); this is
  // ONLY an experiment-bucketing key, read here and nowhere else in the codebase.
  // null = not sent; such a caller can't be bucketed.
  deviceId: string | null;
  userId: string | null; // from optionalAuth — null when signed out or the token is stale
  platform: Platform;
  appVersion: string | null; // display version, e.g. "1.4.2" — for logs / rules that need it
  appBuild: number | null; // integer build number — what version rules should compare
}

// A targeting rule: when `matches(ctx)` is true, `patch` is deep-merged over the config.
// Rules apply in registry order (remoteConfig.rules.ts); a later rule wins on conflicts.
export interface ConfigRule {
  id: string; // short, stable, [a-z0-9-]; shows up in `variant` (and so in analytics)
  description: string; // why this rule exists, for the next reader
  matches: (ctx: ConfigContext) => boolean;
  patch: DeepPartial<RemoteConfig>;
}
