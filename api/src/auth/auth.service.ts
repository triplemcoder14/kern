import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  authenticateLocalUser,
  bootstrapInstallUser,
  getUserById,
} from "../../../storage/user-store";
import { createSessionToken, type AuthUser } from "./session";

@Injectable()
export class AuthService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    const username = process.env.KERN_USERNAME?.trim();
    const password = process.env.KERN_PASSWORD;
    if (!username || !password) {
      return;
    }
    await bootstrapInstallUser(username, password);
  }

  async login(username: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    const stored = await authenticateLocalUser(username, password);
    if (!stored) {
      return null;
    }
    const user = this.toAuthUser(stored);
    return { token: createSessionToken(user), user };
  }

  async resolveSessionUser(session: AuthUser): Promise<AuthUser | null> {
    const stored = await getUserById(session.id);
    if (!stored) {
      return null;
    }
    return this.toAuthUser(stored);
  }

  private toAuthUser(stored: { id: string; username: string; name: string }): AuthUser {
    return {
      id: stored.id,
      username: stored.username,
      name: stored.name,
    };
  }
}
