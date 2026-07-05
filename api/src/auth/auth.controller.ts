import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import {
  clearSessionCookie,
  publicOrigin,
  readSessionToken,
  sessionCookie,
} from "./session";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("me")
  me(@Req() req: Request) {
    const user = readSessionToken(req.headers.cookie);
    if (!user) {
      return { authenticated: false };
    }
    return { authenticated: true, user };
  }

  @Get("github")
  github(@Query("intent") intent: string | undefined, @Res() res: Response) {
    try {
      const url = this.authService.startOAuth(
        "github",
        intent === "signin" ? "signin" : "signup",
      );
      if (url.includes("/app?auth=dev")) {
        const session = this.authService.devSession("github");
        res.setHeader("Set-Cookie", sessionCookie(session.token));
      }
      return res.redirect(url);
    } catch (error) {
      const code = error instanceof Error ? error.message : "auth_failed";
      return res.redirect(`${publicOrigin()}/?auth_error=${encodeURIComponent(code)}`);
    }
  }

  @Get("google")
  google(@Query("intent") intent: string | undefined, @Res() res: Response) {
    try {
      const url = this.authService.startOAuth(
        "google",
        intent === "signup" ? "signup" : "signin",
      );
      if (url.includes("/app?auth=dev")) {
        const session = this.authService.devSession("google");
        res.setHeader("Set-Cookie", sessionCookie(session.token));
      }
      return res.redirect(url);
    } catch (error) {
      const code = error instanceof Error ? error.message : "auth_failed";
      return res.redirect(`${publicOrigin()}/?auth_error=${encodeURIComponent(code)}`);
    }
  }

  @Get("callback/github")
  async githubCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      return res.redirect(`${publicOrigin()}/?auth_error=missing_code`);
    }

    try {
      const session = await this.authService.completeOAuth("github", code, state);
      res.setHeader("Set-Cookie", sessionCookie(session.token));
      return res.redirect(`${publicOrigin()}/app`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "auth_failed";
      return res.redirect(`${publicOrigin()}/?auth_error=${encodeURIComponent(message)}`);
    }
  }

  @Get("callback/google")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      return res.redirect(`${publicOrigin()}/?auth_error=missing_code`);
    }

    try {
      const session = await this.authService.completeOAuth("google", code, state);
      res.setHeader("Set-Cookie", sessionCookie(session.token));
      return res.redirect(`${publicOrigin()}/app`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "auth_failed";
      return res.redirect(`${publicOrigin()}/?auth_error=${encodeURIComponent(message)}`);
    }
  }

  @Post("logout")
  logout(@Res() res: Response) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.json({ ok: true });
  }
}
