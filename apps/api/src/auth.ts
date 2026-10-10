import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { Queryable } from "./database.ts";
import type { Profile } from "@enduro/contracts";
export const cookieName = "ez_session";
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [, salt, key] = encoded.split("$");
  const result = await derive(password, salt);
  const expected = Buffer.from(key, "hex");
  return expected.length === result.length && timingSafeEqual(expected, result);
}
export const profileOf = (row: Record<string, any>): Profile => ({
  id: row.id,
  handle: row.handle,
  displayName: row.display_name,
  city: row.city,
  level: row.level,
  bio: row.bio,
});
export async function newSession(
  db: Queryable,
  reply: FastifyReply,
  userId: string,
  secure: boolean,
) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  await db.query("DELETE FROM sessions WHERE expires_at <= now()");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,now() + interval '7 days')",
    [hashToken(token), userId, csrfToken],
  );
  reply.setCookie(cookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 7 * 24 * 3600,
  });
  return csrfToken;
}
