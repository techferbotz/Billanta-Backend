import { NotFoundError } from "../../../common/errors/AppError";
import { userRepository, UpdateUserProfileData } from "../repository/user.repository";
import { UserDto, toUserDto } from "../dto/user.dto";

export class UserService {
  async getById(userId: string): Promise<UserDto> {
    const user = await userRepository.findById(userId);
    if (!user) {
      // Reachable if the account was deleted while an access token was still live —
      // access tokens are stateless, so deletion can't invalidate them mid-flight.
      throw new NotFoundError("User not found");
    }
    return toUserDto(user);
  }

  async updateProfile(userId: string, data: UpdateUserProfileData): Promise<UserDto> {
    // Nothing to change: return the current profile rather than issuing a pointless write
    // (which would bump updatedAt and make sync think something changed).
    if (Object.keys(data).length === 0) {
      return this.getById(userId);
    }
    const user = await userRepository.updateProfile(userId, data);
    return toUserDto(user);
  }

  /**
   * Delete the account and all of its data — the Google Play "delete my account" path.
   *
   * A hard delete, cascading to refresh tokens (and to company/customers/invoices/settings
   * once those models exist). Any access token already issued stays cryptographically
   * valid until it expires, but every request it makes now 404s because the row is gone.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    await userRepository.deleteById(userId);
  }
}

export const userService = new UserService();
