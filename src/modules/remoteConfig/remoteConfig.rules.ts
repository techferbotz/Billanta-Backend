import { ConfigRule } from "./dto/remoteConfig.dto";

// Targeting rules, in the order they apply. EMPTY today: every caller gets the default config
// (plus any REMOTE_CONFIG_OVERRIDES from the environment). This array is the seam for:
//
//   - a per-version config, e.g.
//       matches: (ctx) => ctx.platform === "android" && ctx.appBuild !== null && ctx.appBuild < 42,
//       patch:   { features: { productCatalogue: false } }   // old builds mis-render the picker
//   - an experiment: bucket DETERMINISTICALLY on the install id so a user stays in one arm
//     across launches — e.g. `ctx.deviceId !== null && bucketOf(ctx.deviceId, "store-2026-10") < 50`,
//     where bucketOf hashes (deviceId + ":" + experiment key) to 0..99. X-Device-Id is OPTIONAL
//     on /config, so guard the null: a caller without an install id is never in an experiment.
//     The rule id lands in `variant`, which is what analytics uses to tell the arms apart.
//   - a per-user override for QA / internal testers: matches: (ctx) => ctx.userId === "<uuid>".
//
// TO ADD A RULE: write it below and add it to RULES — nothing else changes. Patches are typed
// against RemoteConfig, so a wrong key or type is a compile error, and every patch is also
// validated against the defaults at startup. Rules must be pure and fast: this runs on every
// app launch and MUST NOT hit the database. (A DB-backed rule set is a future step — load the
// rows into this array on startup / on an interval, never per request.)
export const RULES: ConfigRule[] = [];
