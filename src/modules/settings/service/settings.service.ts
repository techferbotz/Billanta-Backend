import { settingsRepository } from "../repository/settings.repository";
import { SettingsDto, SettingsWriteData, toSettingsDto } from "../dto/settings.dto";

export class SettingsService {
  /**
   * The user's settings, auto-created with defaults on first access.
   *
   * Unlike Company (which can meaningfully be "not set up yet"), Settings always has
   * sensible defaults, so the client gets a ready-to-use object on the very first call.
   * The get-or-create (and its concurrent-first-GET race handling) lives in the repository,
   * so no Prisma type reaches this layer.
   */
  async getOrCreate(userId: string): Promise<SettingsDto> {
    const settings = await settingsRepository.getOrCreate(userId);
    return toSettingsDto(settings);
  }

  // PUT /settings is a MERGE (see settings.dto.ts): only the fields the client sent are
  // written, so an omitted field never wipes a durable value like the invoice counter.
  async put(userId: string, data: SettingsWriteData): Promise<SettingsDto> {
    const settings = await settingsRepository.upsertMerge(userId, data);
    return toSettingsDto(settings);
  }
}

export const settingsService = new SettingsService();
