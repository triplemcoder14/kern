import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
}

interface SessionPayload extends AuthUser {
  exp: number;
}

const SESSION_COOKIE = "kern_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function authSecret(): string {
  return process.env.KERN_AUTH_SECRET ?? "kern-dev-auth-secret-change-me";
}

function publicOrigin(): string {
  return process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173";
}

function sign(value: string): string {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function encodePayload(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decodePayload(token: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(user: AuthUser): string {
  const payload: SessionPayload = {
    ...user,
    exp: Date.now() + SESSION_TTL_MS,
  };
  return encodePayload(payload);
}

export function readSessionToken(cookieHeader: string | undefined): AuthUser | null {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

  if (!match) {
    return null;
  }

  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  const payload = decodePayload(token);
  if (!payload) {
    return null;
  }

  const { exp: _exp, ...user } = payload;
  return user;
}

export function sessionCookie(token: string): string {
  const secure = publicOrigin().startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = publicOrigin().startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export { publicOrigin, SESSION_COOKIE };
