/**
 * Fixture checks for the remote config module (GET /config). No DB, no server, no network.
 * Run: npx ts-node src/scripts/checkRemoteConfig.ts   (or npm run check:config)
 *
 * Exercises the pieces a future rule / experiment will lean on: the strict merge, the header
 * parsing, the resolve order (defaults -> env overrides -> rules), and the fail-fast on a bad
 * override. Exits 1 on the first failed assertion.
 *
 * HOA protocol 10 §5. See docs/REMOTE_CONFIG.md.
 */

// config/env.ts fails fast on missing REQUIRED vars; this script needs none of them, so
// placeholders satisfy the check when there is no .env. Only MISSING variables are set, so a
// real .env (loaded by dotenv inside env.ts) still wins for anything it defines.
for (const key of ["DATABASE_URL", "JWT_SECRET", "GOOGLE_CLIENT_ID", "ADMIN_API_KEY"]) {
  process.env[key] ??= "check-placeholder";
}

import assert from "node:assert/strict";
import { deepMergeStrict, MergeError } from "../common/deepMerge";
import { MAX_MEDIA_BYTES } from "../common/middleware/upload.middleware";
import { MAX_PAGE_SIZE } from "../common/pagination";
import { MAX_SYNC_BATCH_INVOICES } from "../modules/invoice/invoice.constants";
import { ConfigContext, ConfigRule } from "../modules/remoteConfig/dto/remoteConfig.dto";
import { DEFAULT_REMOTE_CONFIG, TTL_SECONDS } from "../modules/remoteConfig/remoteConfig.defaults";
import { parseContextHeaders } from "../modules/remoteConfig/remoteConfig.context";
import { RemoteConfigService } from "../modules/remoteConfig/service/remoteConfig.service";
import { RULES } from "../modules/remoteConfig/remoteConfig.rules";

let passed = 0;
const check = (name: string, fn: () => void): void => {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
};

const anon: ConfigContext = {
  deviceId: "install-1",
  userId: null,
  platform: "unknown",
  appVersion: null,
  appBuild: null,
};

// A first-launch caller that hasn't generated an install id yet — X-Device-Id is optional.
const noDevice: ConfigContext = { ...anon, deviceId: null };

console.log("\ndeepMergeStrict");

check("nested patch applies and inputs are not mutated", () => {
  const base = { a: { b: true, c: 1 }, d: "x" };
  const patch = { a: { b: false } };
  const out = deepMergeStrict(base, patch);
  assert.deepEqual(out, { a: { b: false, c: 1 }, d: "x" });
  assert.deepEqual(base, { a: { b: true, c: 1 }, d: "x" });
  assert.deepEqual(patch, { a: { b: false } });
});

check("unknown key throws with the full path", () => {
  assert.throws(
    () => deepMergeStrict({ a: { b: true } }, { a: { bee: true } }, "X"),
    (e: unknown) => e instanceof MergeError && /X\.a\.bee: unknown key/.test((e as Error).message)
  );
});

check("type mismatch throws", () => {
  assert.throws(() => deepMergeStrict({ a: true }, { a: "true" }), MergeError);
  assert.throws(() => deepMergeStrict({ a: 1 }, { a: { n: 1 } }), MergeError);
  assert.throws(() => deepMergeStrict({ a: { b: 1 } }, { a: 5 }), MergeError);
  assert.throws(() => deepMergeStrict({ a: 1 }, "not an object"), MergeError);
});

check("null clears a primitive, never an object; a null base takes a primitive", () => {
  assert.deepEqual(deepMergeStrict({ a: "x" as string | null }, { a: null }), { a: null });
  assert.throws(() => deepMergeStrict({ a: { b: 1 } }, { a: null }), MergeError);
  assert.deepEqual(deepMergeStrict({ a: null as string | null }, { a: "now set" }), {
    a: "now set",
  });
  assert.throws(() => deepMergeStrict({ a: null }, { a: { b: 1 } }), MergeError);
});

check("arrays are replaced wholesale", () => {
  assert.deepEqual(deepMergeStrict({ a: [1, 2, 3] }, { a: [9] }), { a: [9] });
  assert.throws(() => deepMergeStrict({ a: [1] }, { a: "9" }), MergeError);
});

console.log("\nheader parsing");

check("well-formed headers parse", () => {
  const ctx = parseContextHeaders(
    { platform: "Android", version: "1.4.2", build: "1042", deviceId: " install-9 " },
    { userId: "u" }
  );
  assert.deepEqual(ctx, {
    deviceId: "install-9",
    userId: "u",
    platform: "android",
    appVersion: "1.4.2",
    appBuild: 1042,
  });
});

check("missing or garbled headers degrade, never throw", () => {
  const ctx = parseContextHeaders(
    { platform: "windows-phone", version: "   ", build: "1.2", deviceId: "  " },
    { userId: null }
  );
  assert.deepEqual(ctx, {
    deviceId: null,
    userId: null,
    platform: "unknown",
    appVersion: null,
    appBuild: null,
  });
  assert.equal(parseContextHeaders({}, { userId: null }).appBuild, null);
  assert.equal(parseContextHeaders({ build: "-5" }, { userId: null }).appBuild, null);
  // Oversized values are capped, not rejected — they are opaque log/hash inputs.
  assert.equal(parseContextHeaders({ version: "v".repeat(99) }, { userId: null }).appVersion?.length, 32);
  assert.equal(parseContextHeaders({ deviceId: "d".repeat(999) }, { userId: null }).deviceId?.length, 128);
  // No identity at all is fine — the JWT is optional on /config (login is optional in Billanta).
  assert.deepEqual(parseContextHeaders({}, { userId: null }), {
    deviceId: null,
    userId: null,
    platform: "unknown",
    appVersion: null,
    appBuild: null,
  });
});

console.log("\ndefaults");

check("JSON-clean (no undefined), absolute links, positive limits", () => {
  const roundTrip = JSON.parse(JSON.stringify(DEFAULT_REMOTE_CONFIG));
  assert.deepEqual(roundTrip, DEFAULT_REMOTE_CONFIG);
  for (const [key, url] of Object.entries(DEFAULT_REMOTE_CONFIG.links)) {
    if (key === "supportEmail") assert.match(url, /^[^@\s]+@[^@\s]+$/);
    else assert.match(url, /^https:\/\//, `links.${key} must be absolute https`);
  }
  assert.ok(DEFAULT_REMOTE_CONFIG.limits.maxMediaBytes > 0);
  assert.ok(DEFAULT_REMOTE_CONFIG.limits.maxSyncBatchInvoices > 0);
  assert.ok(DEFAULT_REMOTE_CONFIG.limits.maxPageSize > 0);
});

check("day-one defaults = today's behaviour: every switch on, no update requirement", () => {
  for (const [key, on] of Object.entries(DEFAULT_REMOTE_CONFIG.features)) {
    assert.equal(on, true, `features.${key} must default to true`);
  }
  assert.equal(DEFAULT_REMOTE_CONFIG.maintenance.enabled, false);
  assert.equal(DEFAULT_REMOTE_CONFIG.update.minSupportedBuild, 0);
  assert.equal(DEFAULT_REMOTE_CONFIG.update.recommendedBuild, 0);
});

check("limits MIRROR the constants the server enforces (never retyped)", () => {
  assert.equal(DEFAULT_REMOTE_CONFIG.limits.maxMediaBytes, MAX_MEDIA_BYTES);
  assert.equal(DEFAULT_REMOTE_CONFIG.limits.maxSyncBatchInvoices, MAX_SYNC_BATCH_INVOICES);
  assert.equal(DEFAULT_REMOTE_CONFIG.limits.maxPageSize, MAX_PAGE_SIZE);
});

console.log("\nresolution");

check("no overrides, no rules -> the defaults, variant 'default'", () => {
  const svc = new RemoteConfigService({
    defaults: DEFAULT_REMOTE_CONFIG,
    overrides: null,
    rules: [],
  });
  const dto = svc.resolve(anon);
  assert.equal(dto.variant, "default");
  assert.equal(dto.ttlSeconds, TTL_SECONDS);
  assert.match(dto.revision, /^[0-9a-f]{12}$/);
  assert.deepEqual(dto.config, DEFAULT_REMOTE_CONFIG);
  // Same input, same fingerprint.
  assert.equal(svc.resolve(anon).revision, dto.revision);
  // A caller with no install id gets exactly the same default.
  const bare = svc.resolve(noDevice);
  assert.equal(bare.variant, "default");
  assert.equal(bare.revision, dto.revision);
});

check("env overrides apply to everyone and change the revision", () => {
  const plain = new RemoteConfigService({
    defaults: DEFAULT_REMOTE_CONFIG,
    overrides: null,
    rules: [],
  });
  const svc = new RemoteConfigService({
    defaults: DEFAULT_REMOTE_CONFIG,
    overrides: { maintenance: { enabled: true, message: "Back in 10 minutes" } },
    rules: [],
  });
  const dto = svc.resolve(anon);
  assert.equal(dto.variant, "default"); // overrides are the baseline, not a targeting variant
  assert.deepEqual(dto.config.maintenance, { enabled: true, message: "Back in 10 minutes" });
  assert.deepEqual(dto.config.features, DEFAULT_REMOTE_CONFIG.features); // untouched
  assert.notEqual(dto.revision, plain.resolve(anon).revision);
});

check("a bad override fails at construction (= startup), naming the path", () => {
  assert.throws(
    () =>
      new RemoteConfigService({
        defaults: DEFAULT_REMOTE_CONFIG,
        overrides: { features: { cloudSyncc: false } }, // typo
        rules: [],
      }),
    /REMOTE_CONFIG_OVERRIDES\.features\.cloudSyncc: unknown key/
  );
  assert.throws(
    () =>
      new RemoteConfigService({
        defaults: DEFAULT_REMOTE_CONFIG,
        overrides: { features: { cloudSync: "false" } }, // string where a boolean lives
        rules: [],
      }),
    MergeError
  );
});

check("rules apply only when they match, in order, and show up in variant", () => {
  const legacyAndroid: ConfigRule = {
    id: "legacy-android-catalogue-off",
    description: "old Android builds mis-render the product picker",
    matches: (ctx) => ctx.platform === "android" && ctx.appBuild !== null && ctx.appBuild < 100,
    patch: { features: { productCatalogue: false } },
  };
  const tester: ConfigRule = {
    id: "qa-tester",
    description: "internal testers keep the catalogue and get the update nudge",
    matches: (ctx) => ctx.userId === "qa-user",
    patch: { features: { productCatalogue: true }, update: { recommendedBuild: 999 } },
  };
  const bucketed: ConfigRule = {
    id: "exp-install-bucket",
    description: "example experiment arm — guard the null: no install id, no experiment",
    matches: (ctx) => ctx.deviceId !== null && ctx.deviceId.startsWith("a"),
    patch: { features: { templateStore: false } },
  };
  const svc = new RemoteConfigService({
    defaults: DEFAULT_REMOTE_CONFIG,
    overrides: null,
    rules: [legacyAndroid, tester, bucketed],
  });

  const nobody = svc.resolve(anon);
  assert.equal(nobody.variant, "default");
  assert.deepEqual(nobody.config, DEFAULT_REMOTE_CONFIG);

  // An install-bucketed rule never matches a caller without an install id.
  assert.equal(svc.resolve(noDevice).variant, "default");
  const inArm = svc.resolve({ ...anon, deviceId: "a1b2" });
  assert.equal(inArm.variant, "default+exp-install-bucket");
  assert.equal(inArm.config.features.templateStore, false);

  const oldAndroid = svc.resolve({ ...anon, platform: "android", appBuild: 42 });
  assert.equal(oldAndroid.variant, "default+legacy-android-catalogue-off");
  assert.equal(oldAndroid.config.features.productCatalogue, false);
  assert.equal(oldAndroid.config.features.cloudSync, true);

  const newAndroid = svc.resolve({ ...anon, platform: "android", appBuild: 100 });
  assert.equal(newAndroid.variant, "default");

  // Both match: the later rule wins on the conflicting key, and both ids are recorded.
  const both = svc.resolve({ ...anon, platform: "android", appBuild: 42, userId: "qa-user" });
  assert.equal(both.variant, "default+legacy-android-catalogue-off+qa-tester");
  assert.equal(both.config.features.productCatalogue, true);
  assert.equal(both.config.update.recommendedBuild, 999);
  assert.notEqual(both.revision, nobody.revision);
});

check("resolveConfig is exactly the document resolve() serves, overrides and rules applied", () => {
  // Server code that must OBEY a value reads it through resolveConfig — so it has to be the
  // very document the app is handed, for every caller, or a switch could say one thing while
  // the server does another.
  const rule: ConfigRule = {
    id: "old-android",
    description: "",
    matches: (ctx) => ctx.platform === "android",
    patch: { features: { productCatalogue: false } },
  };
  const svc = new RemoteConfigService({
    defaults: DEFAULT_REMOTE_CONFIG,
    overrides: { maintenance: { message: "Back soon" } },
    rules: [rule],
  });
  for (const ctx of [anon, noDevice, { ...anon, platform: "android" as const }]) {
    assert.deepEqual(svc.resolveConfig(ctx), svc.resolve(ctx).config);
  }
  assert.equal(svc.resolveConfig({ ...anon, platform: "android" }).features.productCatalogue, false);
  assert.equal(svc.resolveConfig(anon).maintenance.message, "Back soon");
});

check("duplicate or malformed rule ids are rejected at startup", () => {
  const rule: ConfigRule = { id: "dup", description: "", matches: () => false, patch: {} };
  assert.throws(
    () =>
      new RemoteConfigService({
        defaults: DEFAULT_REMOTE_CONFIG,
        overrides: null,
        rules: [rule, rule],
      }),
    /must be unique/
  );
  assert.throws(
    () =>
      new RemoteConfigService({
        defaults: DEFAULT_REMOTE_CONFIG,
        overrides: null,
        rules: [{ ...rule, id: "Not Valid" }],
      }),
    /must be unique and/
  );
});

check("the live RULES registry itself constructs cleanly", () => {
  const svc = new RemoteConfigService({
    defaults: DEFAULT_REMOTE_CONFIG,
    overrides: null,
    rules: RULES,
  });
  assert.equal(typeof svc.resolve(anon).revision, "string");
});

console.log(`\n${passed} passed, 0 failed\n`);
