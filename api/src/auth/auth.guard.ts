import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { readSessionToken } from "./session";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const session = readSessionToken(request.headers.cookie);
    if (!session) {
      throw new UnauthorizedException({ code: "unauthenticated" });
    }

    const user = await this.authService.resolveSessionUser(session);
    if (!user) {
      throw new UnauthorizedException({ code: "unauthenticated" });
    }

    (request as Request & { kernUser?: typeof user }).kernUser = user;
    return true;
  }
}

export function currentKernUser(request: Request) {
  return (request as Request & { kernUser?: Awaited<ReturnType<AuthService["resolveSessionUser"]>> })
    .kernUser;
}
