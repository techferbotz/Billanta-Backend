import { settingsRepository } from "../repository/settings.repository";
import { SettingsDto, toSettingsDto } from "../dto/settings.dto";
import { Values } from "../../../fields/values";
import { settingsDefaults } from "../../../fields/forms";

export class SettingsService {
  /**
   * The user's settings, auto-created with the settings form's defaults on first access.
   *
   * Unlike Company (which can meaningfully be "not set up yet"), Settings always has
   * sensible defaults, so the client gets a ready-to-use object on the very first call.
   */
  async getOrCreate(userId: string): Promise<SettingsDto> {
    return toSettingsDto(await settingsRepository.getOrCreate(userId, settingsDefaults()));
  }

  async put(userId: string, values: Values): Promise<SettingsDto> {
    return toSettingsDto(await settingsRepository.upsert(userId, values));
  }

  async patch(userId: string, patch: Values): Promise<SettingsDto> {
    return toSettingsDto(await settingsRepository.patch(userId, patch, settingsDefaults()));
  }
}

export const settingsService = new SettingsService();
