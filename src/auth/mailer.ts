/**
 * Sends magic-link emails. Resend when `RESEND_API_KEY` is set; else the console transport prints
 * the link (local development only — it is refused in Vercel production).
 */
import { Resend } from "resend";
import type { Editor } from "@/db/schema";

export type MagicLinkKind = "invite" | "sign-in";

/** An Editor who never logged in gets the invite text. Auth.js sets `emailVerified` on first login. */
export function magicLinkKind(editor: Pick<Editor, "emailVerified">): MagicLinkKind {
  return editor.emailVerified === null ? "invite" : "sign-in";
}

export interface MagicLinkMessage {
  to: string;
  url: string;
  kind: MagicLinkKind;
  /** The login page, where the person can get a new link. */
  loginUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function composeMagicLinkEmail(message: Omit<MagicLinkMessage, "to">) {
  const invite = message.kind === "invite";
  const subject = invite
    ? "You are invited to edit the Bike GR Calendar"
    : "Sign in to the Bike GR Calendar";
  const intro = invite
    ? "You are invited to edit the Bike GR Calendar. Use this link to sign in:"
    : "Use this link to sign in to the Bike GR Calendar:";
  const outro =
    `The link works once and expires in 24 hours. To get a new link, go to ${message.loginUrl}. ` +
    "If you did not ask for this email, you can ignore it.";

  const text = `${intro}\n\n${message.url}\n\n${outro}\n`;
  const html =
    `<p>${escapeHtml(intro)}</p>` +
    `<p><a href="${escapeHtml(message.url)}">Sign in to the Bike GR Calendar</a></p>` +
    `<p>${escapeHtml(outro)}</p>`;
  return { subject, text, html };
}

interface ResendLike {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }): Promise<{ error: { message: string } | null }>;
  };
}

export interface Mailer {
  transport: "resend" | "console";
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}

export interface MailerOptions {
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  resendFactory?: (apiKey: string) => ResendLike;
}

export function createMailer(options: MailerOptions = {}): Mailer {
  const env = options.env ?? process.env;
  const apiKey = env.RESEND_API_KEY;

  if (apiKey) {
    const resend = (options.resendFactory ?? ((key) => new Resend(key)))(apiKey);
    const from = env.EMAIL_FROM ?? "Bike GR Calendar <no-reply@calendar.bikegr.org>";
    return {
      transport: "resend",
      async sendMagicLink(message) {
        const { error } = await resend.emails.send({
          from,
          to: message.to,
          ...composeMagicLinkEmail(message),
        });
        if (error) throw new Error(`Resend could not send the magic link: ${error.message}`);
      },
    };
  }

  if (env.VERCEL_ENV === "production") {
    throw new Error("RESEND_API_KEY is not set. The console transport is not allowed in production.");
  }
  const log = options.log ?? ((line: string) => console.info(line));
  return {
    transport: "console",
    async sendMagicLink(message) {
      log(`[magic-link] ${message.kind} for ${message.to}: ${message.url}`);
    },
  };
}
