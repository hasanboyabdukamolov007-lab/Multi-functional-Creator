import type { Config } from "../config.js";

export interface Mailer {
  send(to: string, subject: string, text: string, html?: string): Promise<boolean>;
  readonly configured: boolean;
}

export async function createMailer(config: Config, log: (m: string) => void): Promise<Mailer> {
  if (!config.smtpUrl) {
    return {
      configured: false,
      async send(to, subject) {
        log(`[mail] SMTP not configured — not sending "${subject}" to ${to}`);
        return false;
      },
    };
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport(config.smtpUrl);
  return {
    configured: true,
    async send(to, subject, text, html) {
      await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
      return true;
    },
  };
}
