import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type { Database, Row } from "./database.ts";
export type MailSender = (row: Row) => Promise<void>;
export function createMailSender(
  env: NodeJS.ProcessEnv,
  dir: string,
): MailSender {
  const mode = env.MAIL_MODE ?? "file";
  if (mode === "file") {
    if (env.NODE_ENV === "production")
      throw new Error("File mail is disabled in production. Configure SMTP.");
    return async (r) => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(
        join(dir, `${r.id}.txt`),
        `To: ${r.recipient}\nSubject: ${r.subject}\n\n${r.body}`,
        { encoding: "utf8", mode: 0o600 },
      );
    };
  }
  if (
    mode !== "smtp" ||
    !env.SMTP_HOST ||
    !env.SMTP_USER ||
    !env.SMTP_PASSWORD ||
    !env.MAIL_FROM
  )
    throw new Error(
      "Configure MAIL_MODE=smtp, SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM.",
    );
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 465),
    secure: env.SMTP_SECURE !== "false",
    requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return async (r) => {
    await transport.sendMail({
      from: env.MAIL_FROM,
      to: r.recipient,
      subject: r.subject,
      text: r.body,
      messageId: `<${r.id}@enduro.zone>`,
    });
  };
}
export async function deliverMail(db: Database, send: MailSender) {
  // Cleanup commits separately so token locks are never held during SMTP I/O.
  await db.query("DELETE FROM account_tokens WHERE expires_at<=now()");
  await db.query(
    "UPDATE mail_outbox SET body='' WHERE body<>'' AND (attempts>=5 OR (purpose='reset' AND created_at<now()-interval '30 minutes') OR (purpose='verify' AND created_at<now()-interval '24 hours'))",
  );
  return db.transaction(async (tx) => {
    const [r] = await tx.query(
      "SELECT * FROM mail_outbox WHERE sent_at IS NULL AND next_attempt_at<=now() AND attempts<5 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (!r) return false;
    const expired =
      new Date(r.created_at).getTime() +
        (r.purpose === "reset" ? 30 : 1440) * 60000 <=
      Date.now();
    if (expired) {
      await tx.query(
        "UPDATE mail_outbox SET body='',sent_at=now() WHERE id=$1",
        [r.id],
      );
      return true;
    }
    try {
      await send(r);
      await tx.query(
        "UPDATE mail_outbox SET body='',sent_at=now(),attempts=attempts+1 WHERE id=$1",
        [r.id],
      );
    } catch {
      await tx.query(
        "UPDATE mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',body=CASE WHEN attempts>=4 THEN '' ELSE body END WHERE id=$1",
        [r.id],
      );
    }
    return true;
  });
}
