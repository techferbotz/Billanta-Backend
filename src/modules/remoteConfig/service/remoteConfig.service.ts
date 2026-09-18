import crypto from "crypto";
import { config } from "../../../config/env";
import { deepMergeStrict } from "../../../common/deepMerge";
import { ConfigContext, ConfigRule, RemoteConfig, RemoteConfigDto } from "../dto/remoteConfig.dto";
import { DEFAULT_REMOTE_CONFIG, SCHEMA_VERSION, TTL_SECONDS } from "../remoteConfig.defaults";
import { RULES } from "../remoteConfig.rules";

// The three layers, least to most specific. `resolve` applies them in this order, so the most
// specific layer wins on a conflict.
export interface RemoteConfigLayers {
  defaults: RemoteConfig;
  // JSON patch from the environment (REMOTE_CONFIG_OVERRIDES), applied for EVERY caller — how
  // ops flips a flag with an .env change instead of a code deploy. null = none set.
  overrides: Record<string, unknown> | null;
  // Targeting rules (per version / platform / device bucket / user). Applied in order.
  rules: ConfigRule[];
}

// Resolves the config for one caller. Pure and synchronous on purpose (no DB, no await): it
// runs on every app launch, so it must be cheap and impossible to take down. A DB-backed layer
// later should be loaded into memory on an interval, not queried per request.
export class RemoteConfigService {
  // defaults + env overrides, computed once.
  private readonly base: RemoteConfig;

  constructor(private readonly layers: RemoteConfigLayers) {
    // Validate and apply the env overrides ONCE, at construction (= process start), so a bad
    // override fails the boot loudly instead of failing every request quietly.
    this.base =
      layers.overrides === null
        ? layers.defaults
        : deepMergeStrict(layers.defaults, layers.overrides, "REMOTE_CONFIG_OVERRIDES");

    // Same fail-fast for rule patches (already type-checked; this catches shape mistakes the
    // type system can't, e.g. null-ing an object), and rejects duplicate / malformed ids.
    const seen = new Set<string>();
    for (const rule of layers.rules) {
      if (!/^[a-z0-9-]+$/.test(rule.id) || seen.has(rule.id)) {
        throw new Error(`Remote config rule id "${rule.id}" must be unique and [a-z0-9-]`);
      }
      seen.add(rule.id);
      deepMergeStrict(this.base, rule.patch, `rule:${rule.id}`);
    }
  }

  resolve(ctx: ConfigContext): RemoteConfigDto {
    let resolved = this.base;
    const applied: string[] = [];
    for (const rule of this.layers.rules) {
      if (rule.matches(ctx)) {
        resolved = deepMergeStrict(resolved, rule.patch, `rule:${rule.id}`);
        applied.push(rule.id);
      }
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      variant: ["default", ...applied].join("+"),
      revision: fingerprint(resolved),
      ttlSeconds: TTL_SECONDS,
      config: resolved,
    };
  }
}

// Short content hash so the client (and our logs) can tell "did anything change?" without
// diffing. Key order is deterministic: every layer is built from the defaults' own key order.
const fingerprint = (cfg: RemoteConfig): string =>
  crypto.createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 12);

export const remoteConfigService = new RemoteConfigService({
  defaults: DEFAULT_REMOTE_CONFIG,
  overrides: config.remoteConfigOverrides,
  rules: RULES,
});
