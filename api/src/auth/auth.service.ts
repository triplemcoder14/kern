import { Injectable } from "@nestjs/common";
import {
  createSessionToken,
  publicOrigin,
  randomState,
  type AuthUser,
} from "./session";

interface PendingOAuth {
  provider: "github" | "google";
  intent: "signup" | "signin";
  expiresAt: number;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class AuthService {
  private pending = new Map<string, PendingOAuth>();

  private callbackUrl(provider: "github" | "google"): string {
    const apiPort = process.env.KERN_API_PORT ?? "3000";
    const configured = process.env.KERN_AUTH_CALLBACK_ORIGIN?.replace(/\/$/, "");
    const base = configured ?? `http://127.0.0.1:${apiPort}`;
    return `${base}/api/auth/callback/${provider}`;
  }

  private prunePending(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= now) {
        this.pending.delete(key);
      }
    }
  }

  startOAuth(provider: "github" | "google", intent: "signup" | "signin"): string {
    if (process.env.KERN_AUTH_DEV === "1") {
      return `${publicOrigin()}/app?auth=dev`;
    }

    const state = randomState();
    this.prunePending();
    this.pending.set(state, {
      provider,
      intent,
      expiresAt: Date.now() + 1000 * 60 * 10,
    });

    const redirectUri = encodeURIComponent(this.callbackUrl(provider));

    if (provider === "github") {
      const clientId = process.env.KERN_GITHUB_CLIENT_ID;
      if (!clientId) {
        throw new Error("github_not_configured");
      }
      return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent("read:user user:email")}&state=${state}`;
    }

    const clientId = process.env.KERN_GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("google_not_configured");
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent("openid email profile")}&state=${state}&prompt=select_account`;
  }

  async completeOAuth(
    provider: "github" | "google",
    code: string,
    state: string,
  ): Promise<{ token: string; user: AuthUser }> {
    if (process.env.KERN_AUTH_DEV === "1") {
      const user = this.devUser(provider);
      return { token: createSessionToken(user), user };
    }

    const pending = this.pending.get(state);
    this.pending.delete(state);

    if (!pending || pending.provider !== provider || pending.expiresAt <= Date.now()) {
      throw new Error("invalid_state");
    }

    const user =
      provider === "github"
        ? await this.githubUser(code)
        : await this.googleUser(code);

    return { token: createSessionToken(user), user };
  }

  devSession(provider: "github" | "google"): { token: string; user: AuthUser } {
    const user = this.devUser(provider);
    return { token: createSessionToken(user), user };
  }

  private devUser(provider: "github" | "google"): AuthUser {
    return {
      id: `dev-${provider}`,
      email: `dev@${provider}.local`,
      name: provider === "github" ? "Dev GitHub User" : "Dev Google User",
      provider,
    };
  }

  private async githubUser(code: string): Promise<AuthUser> {
    const clientId = process.env.KERN_GITHUB_CLIENT_ID;
    const clientSecret = process.env.KERN_GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("github_not_configured");
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: this.callbackUrl("github"),
      }),
    });

    const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenRes.ok || !tokenBody.access_token) {
      throw new Error("github_token_failed");
    }

    const profileRes = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenBody.access_token}`,
        "User-Agent": "kern-api",
      },
    });

    const profile = (await profileRes.json()) as {
      id?: number;
      login?: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string;
    };

    let email = profile.email ?? "";
    if (!email) {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenBody.access_token}`,
          "User-Agent": "kern-api",
        },
      });
      const emails = (await emailRes.json()) as GitHubEmail[];
      email =
        emails.find((item) => item.primary && item.verified)?.email ??
        emails.find((item) => item.verified)?.email ??
        `${profile.login ?? "user"}@users.noreply.github.com`;
    }

    return {
      id: String(profile.id ?? profile.login ?? "github-user"),
      email,
      name: profile.name ?? profile.login ?? "GitHub user",
      avatarUrl: profile.avatar_url,
      provider: "github",
    };
  }

  private async googleUser(code: string): Promise<AuthUser> {
    const clientId = process.env.KERN_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.KERN_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("google_not_configured");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: this.callbackUrl("google"),
        grant_type: "authorization_code",
      }),
    });

    const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenRes.ok || !tokenBody.access_token) {
      throw new Error("google_token_failed");
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });

    const profile = (await profileRes.json()) as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    return {
      id: profile.id ?? "google-user",
      email: profile.email ?? "unknown@gmail.com",
      name: profile.name ?? "Google user",
      avatarUrl: profile.picture,
      provider: "google",
    };
  }
}
