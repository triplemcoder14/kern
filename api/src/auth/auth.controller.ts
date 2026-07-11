import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { clearSessionCookie, readSessionToken, sessionCookie } from "./session";

interface LoginBody {
  username?: string;
  password?: string;
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("me")
  async me(@Req() req: Request) {
    const session = readSessionToken(req.headers.cookie);
    if (!session) {
      return { authenticated: false };
    }
    const user = await this.authService.resolveSessionUser(session);
    if (!user) {
      return { authenticated: false };
    }
    return { authenticated: true, user };
  }

  @Post("login")
  async login(@Body() body: LoginBody, @Res() res: Response) {
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    if (!username || !password) {
      throw new UnauthorizedException({ code: "invalid_credentials" });
    }

    const session = await this.authService.login(username, password);
    if (!session) {
      throw new UnauthorizedException({ code: "invalid_credentials" });
    }

    res.setHeader("Set-Cookie", sessionCookie(session.token));
    return res.json({ authenticated: true, user: session.user });
  }

  @Post("logout")
  logout(@Res() res: Response) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.json({ ok: true });
  }
}
