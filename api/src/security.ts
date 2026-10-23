import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
export const COOKIE = "sc_session";
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
// CSRF-токен выводится из случайного HttpOnly-токена; хранить его открыто в БД не нужно.
export const csrfFor = (sessionToken: string) =>
  hashToken(`studentconnect:csrf:${sessionToken}`);
export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password);
export function checkCsrf(req: Request, rawToken: string) {
  const value = req.get("X-CSRF-Token") ?? "";
  const expected = csrfFor(rawToken);
  return (
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
export type CookieSettings = {
  production: boolean;
  sameSite: "lax" | "strict" | "none";
};
export function cookieOptions(settings: CookieSettings) {
  return {
    httpOnly: true,
    secure: settings.production,
    sameSite: settings.sameSite,
    path: "/",
  } as const;
}
export async function issueSession(
  db: PrismaClient,
  userId: string,
  req: Request,
  res: Response,
  settings: CookieSettings,
  onRevoke?: (hash: string) => void,
) {
  const token = newToken();
  // При входе меняем идентификатор сессии, исключая фиксацию старой сессии.
  const old = req.cookies?.[COOKIE];
  await db.$transaction(async (tx) => {
    if (typeof old === "string")
      await tx.session.deleteMany({ where: { tokenHash: hashToken(old) } });
    await tx.session.deleteMany({
      where: { userId, expiresAt: { lte: new Date() } },
    });
    await tx.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_MS),
      },
    });
  });
  if (typeof old === "string") onRevoke?.(hashToken(old));
  res.cookie(COOKIE, token, { ...cookieOptions(settings), maxAge: SESSION_MS });
  return csrfFor(token);
}
