# Remote config — `GET /config`

> The JSON document the Android app reads at launch to decide how to behave: which features are
> on, whether a build must update, whether we're in maintenance, the caps it should respect, the
> legal links. This doc is for both sides: **backend** (how it's built, how to change a value, how
> to add targeting later) and **app** (the contract — also in [`API.md`](API.md#remote-config)).
>
> House of Apps protocol **10 — Remote config (backend)**; the app half is protocol 11. The route,
> header names, env-var name and the `features` / `update` / `maintenance` / `links` shapes are
> **identical in every HOA backend** on purpose — one shared client implementation consumes them.

---

## 1. Why it exists

An app release takes days to reach every device and can't be forced. A remote config lets us
change behaviour on every installed app **without a release** — hide a feature that's
misbehaving, show a maintenance message during a migration, tell old builds to update — and
later serve **different** behaviour to different builds or users (a staged rollout, an A/B
experiment) from the same endpoint.

Today it serves **one default document to everyone**. Everything below about targeting is the
seam for that future: in place, and empty.

```
                DEFAULT_REMOTE_CONFIG          (code — remoteConfig.defaults.ts)
                        │  deepMergeStrict
                        ▼
              REMOTE_CONFIG_OVERRIDES          (env — a JSON patch, applied to EVERY caller;
                        │  deepMergeStrict       flip a switch with .env + container recreate)
                        ▼
      matching rules from RULES, in order       (code — remoteConfig.rules.ts; EMPTY today;
                        │  deepMergeStrict        per version / platform / install / user)
                        ▼
         { schemaVersion, variant, revision, ttlSeconds, config }   →  GET /config
```

Each layer is applied with a **strict** merge: a key that isn't in the default, or a value of the
wrong type, throws. That matters because clients *ignore unknown keys* — a typo'd override would
otherwise silently do nothing and nobody would notice the switch never flipped.

Billanta is offline-first, so nothing here can stop the core promise: creating, rendering and
sharing an invoice works with no network at all, and therefore with no config at all.

---

## 2. The endpoint

`GET /config` — **everything about the caller is optional.** No token (login is optional in
Billanta anyway), no install id, no build headers, no query string. Send what you have: without
an install id the caller can't be bucketed into an experiment, and without a JWT it can't receive
a per-user override.

It never touches the database — it answers even when Postgres is down.

Response (`data` inside the standard envelope):

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Bumped **only** when a key is removed or renamed. Adding a key doesn't bump it. |
| `variant` | Which resolution the caller got: `"default"`, or `"default+<ruleId>+…"` naming every rule that applied. The client logs it with analytics. |
| `revision` | 12-hex fingerprint of `config`. Changes whenever any value changes — "did anything change?" without a diff. |
| `ttlSeconds` | How long the client may use the document before re-fetching (3600). It also re-fetches on every cold start. |
| `config` | The document (§3). |

The response is `Cache-Control: no-store` — it can differ per caller and change without a deploy,
so nothing between the app and the server may cache it; the client caches by `ttlSeconds`.

Live example (today's defaults, verbatim):

```json
{
  "success": true,
  "data": {
    "schemaVersion": 1,
    "variant": "default",
    "revision": "23e0a1c074d1",
    "ttlSeconds": 3600,
    "config": {
      "features": { "googleLogin": true, "cloudSync": true, "templateStore": true,
                    "premiumTemplates": true, "productCatalogue": true, "mediaUpload": true },
      "update": { "minSupportedBuild": 0, "recommendedBuild": 0, "androidStoreUrl": null,
                  "iosStoreUrl": null, "message": null },
      "maintenance": { "enabled": false, "message": null },
      "limits": { "maxMediaBytes": 8388608, "maxSyncBatchInvoices": 500, "maxPageSize": 100 },
      "links": { "privacyPolicy": "https://billanta.ferbotz.com/privacy",
                 "terms": "https://billanta.ferbotz.com/terms",
                 "deleteAccount": "https://billanta.ferbotz.com/delete-account",
                 "supportEmail": "support@ferbotz.com" }
    }
  }
}
```

---

## 3. The document, key by key

Type: `RemoteConfig` in `src/modules/remoteConfig/dto/remoteConfig.dto.ts`. **Every default
equals today's behaviour**, so an app that starts honouring the config changes nothing until a
value is deliberately flipped.

| Key | Default | What the app does with it |
| --- | --- | --- |
| `features.googleLogin` | `true` | Show the "Sign in with Google" entry point. Off ⇒ the app stays fully usable, offline-only. |
| `features.cloudSync` | `true` | Allow backup/restore and `POST /invoices/sync`. Off ⇒ stop syncing app-wide (local data untouched). |
| `features.templateStore` | `true` | Allow browsing/downloading templates (`GET /templates`). Off ⇒ already-cached templates still render. |
| `features.premiumTemplates` | `true` | Show the premium-template / upgrade UI (templates flagged `isPremium`). |
| `features.productCatalogue` | `true` | Show the reusable line-item catalogue (`/products`). |
| `features.mediaUpload` | `true` | Show logo / signature / QR image upload (`POST /media`). |
| `update.minSupportedBuild` | `0` | Builds **below** this must update to continue (hard block). `0` = no requirement. |
| `update.recommendedBuild` | `0` | Builds below this see a dismissible "update available" nudge. `0` = none. |
| `update.androidStoreUrl` / `iosStoreUrl` | `null` | Where the update prompt sends the user. **TODO** once the Play listing exists. |
| `update.message` | `null` | Optional copy for either prompt. |
| `maintenance.enabled` | `false` | `true` ⇒ the app shows `maintenance.message` instead of its cloud features. |
| `maintenance.message` | `null` | The copy for that screen. |
| `limits.maxMediaBytes` | `8388608` | Reject an image above this **before** uploading. **Mirrors** `common/middleware/upload.middleware.ts:MAX_MEDIA_BYTES`. |
| `limits.maxSyncBatchInvoices` | `500` | Chunk a sync push to at most this many invoices. Mirrors `modules/invoice/invoice.constants.ts`. |
| `limits.maxPageSize` | `100` | The ceiling on `?limit` for every list endpoint. Mirrors `common/pagination.ts:MAX_PAGE_SIZE`. |
| `links.privacyPolicy` / `terms` / `deleteAccount` | absolute URLs | `config.publicUrl` (`APP_PUBLIC_URL`) + `legal/legal.view.ts:LEGAL_PATHS` — the same paths the pages are served on (HOA protocol 12). Use these, never hard-coded URLs; where the app must show them is in §4. |
| `links.supportEmail` | `support@ferbotz.com` | `legal/legal.view.ts:LEGAL_CONTACT_EMAIL` — the address the pages themselves publish. |

`features.*` are **client-side gates only**. Turning one off hides the entry point in the app; the
API route itself keeps working (an incident that needs the API closed is handled at the server,
not here). The `limits.*` numbers are **mirrored, never retyped** — `check:config` asserts they
still equal the constants the server enforces.

---

## 4. The client contract (app)

1. **Fetch on every cold start**, and again once `ttlSeconds` have passed. Cache the last good
   `data`. If the request fails, keep using the cached copy or the compiled-in defaults —
   **config must never be the reason the app can't open**, and it must never block launch.
2. **Apply `maintenance` and `update` before anything else**, then gate entry points by
   `features.*`.
3. **Ignore keys you don't recognise; default keys that are missing LEAF BY LEAF.** New keys
   appear without an app release; keys are only ever removed with a `schemaVersion` bump.
   Defaulting a whole *section* wipes the unmentioned leaves the moment a partial section arrives.
4. Compare `update.*Build` against the **integer build number** (Android `versionCode`), never the
   version string — `"1.10.0" < "1.9.0"` is true as a string. An unknown build (`0`) is never
   blocked.
5. **Send these headers on every request** (not just `/config`), so the backend can later target a
   build, platform or install without an app update — a caller that never sent them can't be
   targeted:

   ```
   X-App-Platform: android        # "android" | "ios" | "web"
   X-App-Version: 1.4.2           # display version
   X-App-Build: 1042              # integer build number / versionCode
   X-Device-Id: <install uuid>    # stable per-install id — the experiment-bucketing key
   Authorization: Bearer <jwt>    # when signed in — enables per-user overrides
   ```

   All optional; a garbled value is treated as absent (never a `400`). `X-Device-Id` is read
   **only** here, for bucketing: Billanta's ownership model is `userId` and nothing else.
6. Log `variant` and `revision` with the applied document, so "is this device on the new config?"
   is answerable — and attach both to analytics events once there is an analytics SDK.
7. **Show the legal links from `links.*`** (HOA protocol 12 §3): Privacy Policy, Terms & Conditions,
   Delete account and Contact support in **Settings**; the consent line *"By continuing you agree to
   our Terms & Conditions and Privacy Policy"* at **sign-in**; Terms + Privacy on the **premium /
   upgrade** screen. Open URLs in an in-app browser tab; support opens a `mailto:`.

---

## 5. Changing a value (backend / ops)

### 5a. For everyone, permanently — edit the default

Edit `DEFAULT_REMOTE_CONFIG` in `src/modules/remoteConfig/remoteConfig.defaults.ts`, run
`npm run typecheck && npm run check:config`, commit, deploy ([`DEPLOY.md`](DEPLOY.md)). Values
that mirror a server rule (upload cap, sync batch cap, page size, legal URLs) are **imported**
from the module that enforces them — change them *there*, and the config follows.

Any change to the document is also a `BE-nnn` entry in the contract folder (§7).

### 5b. For everyone, right now, without a deploy — `REMOTE_CONFIG_OVERRIDES`

Set the env var to a **JSON patch** of the document (only the keys you're changing), then recreate
the container (env is read at start; no rebuild needed):

```bash
# on the box, in the repo checkout — one line, no quotes around the JSON
echo 'REMOTE_CONFIG_OVERRIDES={"maintenance":{"enabled":true,"message":"Back in 10 minutes"}}' >> .env
docker compose -f docker-compose.prod.yml up -d app
curl -s https://billanta.ferbotz.com/config | head -c 400
```

Rules, enforced at startup (the app **refuses to boot** otherwise — deliberately, see §1):

- must be a JSON object; every key must already exist in the default, at the same nesting;
- a value must have the default's type (`true` not `"true"`); `null` is allowed for any primitive
  (clears a nullable field) but never for an object; arrays replace wholesale;
- the failure names the path, e.g. `REMOTE_CONFIG_OVERRIDES.features.nope: unknown key` — read it
  with `docker compose -f docker-compose.prod.yml logs --tail=30 app`.

Overrides are the **baseline for everyone**, so `variant` stays `"default"` — they are not a
targeting variant. To undo: remove the line, `up -d app` again. This is the emergency kill switch:
it reaches every app within one container restart plus the client's `ttlSeconds` or next cold
start.

### 5c. For some callers — a rule in `RULES`

`src/modules/remoteConfig/remoteConfig.rules.ts` is an ordered registry, empty today. A rule is
`{ id, description, matches(ctx), patch }`; when `matches` is true its `patch` is merged over the
base, later rules winning on conflicts, and its `id` is appended to `variant`.

```ts
// A per-version fix: an old Android build mis-renders the product picker.
{
  id: "legacy-android-catalogue-off",
  description: "builds < 42 crash on the product picker; hide it until they update",
  matches: (ctx) => ctx.platform === "android" && ctx.appBuild !== null && ctx.appBuild < 42,
  patch: { features: { productCatalogue: false } },
},
// An experiment: half the installs see the template store first. Deterministic on the install
// so a user stays in one arm across launches; `variant` = "default+exp-store-first" for them.
{
  id: "exp-store-first",
  description: "does opening on the template store improve first-invoice rate? 50/50 by install",
  matches: (ctx) => ctx.deviceId !== null && bucketOf(ctx.deviceId, "store-first-2026-10") < 50,
  patch: { features: { templateStore: true } },
},
```

where `bucketOf(deviceId, experimentKey)` hashes `deviceId + ":" + experimentKey` (sha256) and
maps it to `0..99`. Salting with the experiment key keeps different experiments' arms
independent; hashing the install id keeps assignment stable per install.

`ctx` is `ConfigContext`: `deviceId | null`, `userId | null`, `platform`
(`android|ios|web|unknown`), `appVersion | null`, `appBuild | null` — from the optional
`X-Device-Id`, the optional JWT (`optionalAuth`), and the `X-App-*` headers. A rule that needs a
value the caller didn't send simply doesn't match — so an install-bucketed rule must guard
`ctx.deviceId !== null` (as above): no install id, no experiment.

Rules must be **pure and fast** (no DB, no I/O): this runs on every app launch. Patches are typed
(`DeepPartial<RemoteConfig>`, so a wrong key is a compile error) and validated against the default
at startup; ids must be unique and `[a-z0-9-]`. Add a case to
`src/scripts/checkRemoteConfig.ts` when you add a rule with any logic in `matches`.

---

## 6. Design rules (why it's shaped like this)

- **Additive-only, defaults = today.** The two properties that make "no app release needed" true.
  Removing/renaming a key bumps `SCHEMA_VERSION` and is a breaking CHANGELOG entry.
- **Strict merge everywhere.** The one place a silent failure would be invisible (clients skip
  unknown keys) is the one place failures were made loud.
- **Fail at boot, not per request.** Env overrides and rule patches are validated in the service
  constructor, so a bad deploy crash-loops immediately (like a missing required env var) instead
  of serving 500s.
- **No database on the path.** Pure + synchronous; nothing to time out; the config is up even when
  Postgres isn't. A future DB-backed rule store must load into memory on an interval, never be
  queried per request.
- **Mirror, don't retype.** Numbers the server enforces are imported from the enforcing module
  (`invoice.constants.ts` was extracted for exactly this), and a fixture asserts it.
- **Nothing about the caller is required.** `/config` is mounted with the public routes and uses
  `optionalAuth`: it must be fetchable by any build in any state — a first launch that has never
  signed in, an expired token, an old build sending no headers. Identity is still *used* when
  present; it is the targeting input.

---

## 7. Obligations to the app side

The contract is shared, so **every change to `/config` — a new key, a changed default, a new rule
that changes what some users see — is a `BE-nnn` entry** in the contract folder
(`Billanta-Contract/backend/CHANGELOG.md`), with `backend/API.md` updated. A new key is additive
and needs no app change, but the app team must still know it exists to build the UI that honours
it. Removing or renaming a key is breaking and bumps `schemaVersion`.

---

## 8. Verification

```bash
npm run typecheck         # types
npm run check:config      # 16 fixtures: merge rules, header parsing, resolve order, fail-fast,
                          # and that limits.* still mirror the enforcing constants
```

Smoke against a running server (no DB needed — the endpoint never touches it):

```bash
curl -s -i http://localhost:3000/config | head -1        # 200 with NO headers at all
curl -s http://localhost:3000/config -H "X-Device-Id: dev-1" \
  -H "X-App-Platform: android" -H "X-App-Version: 1.0.0" -H "X-App-Build: 7"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/invoices   # still 401
```

And that a bad override really does stop the boot:

```bash
REMOTE_CONFIG_OVERRIDES='{"features":{"nope":true}}' npx ts-node --files src/app.ts
# MergeError: REMOTE_CONFIG_OVERRIDES.features.nope: unknown key   (exit 1)
```

---

## 9. Not built yet (designed next steps)

- **Targeting rules** — `RULES` is empty; §5c is the recipe.
- **DB-backed rules with an admin endpoint** (`PUT /admin/config/rules`, behind `adminAuth`),
  loaded into `RULES` on startup and on an interval, so a non-developer can run an experiment.
- **`ETag` / `If-None-Match` → `304`** using `revision`, to make the hourly re-fetch nearly free.
- **Store URL** in `update` once the Play listing exists.
