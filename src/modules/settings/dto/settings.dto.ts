import { Settings } from "@prisma/client";
import { parseValuesOr400 } from "../../../common/values";
import { Values, storedValues } from "../../../fields/values";

/// Per-user defaults for the new-invoice screen: settings_* field id -> value (docs/FIELDS.md §7.3).
/// Numbers travel as decimal strings ("18", "42"), like every number in a values map.
export interface SettingsDto {
  values: Values;
  createdAt: string;
  updatedAt: string;
}

export const toSettingsDto = (s: Settings): SettingsDto => ({
  values: storedValues(s.values),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

const OWNERS = ["settings"] as const;

/// PUT /settings — the whole map. An omitted setting is cleared, the running invoice number
/// included, so a client that only means to change one setting should PATCH.
export const parseSettingsPut = (body: Record<string, unknown>): Values =>
  parseValuesOr400(body.values, "values", { owners: OWNERS, patch: false });

/// PATCH /settings — a merge: null clears a key, an absent key is untouched.
export const parseSettingsPatch = (body: Record<string, unknown>): Values =>
  parseValuesOr400(body.values, "values", { owners: OWNERS, patch: true });
