/**
 * Sends the Submission emails. Resend when `RESEND_API_KEY` is set; else the console transport
 * prints each message (local development only — refused on every Vercel deployment, as the
 * magic-link mailer in src/auth/mailer.ts). Tests use {@link captureTransport}.
 */
import { Resend } from "resend";

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  kind: "resend" | "console" | "capture";
  send(message: EmailMessage): Promise<void>;
}

interface ResendLike {
  emails: {
    send(payload: EmailMessage & { from: string }): Promise<{ error: { message: string } | null }>;
  };
}

export interface TransportOptions {
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  resendFactory?: (apiKey: string) => ResendLike;
}

const DEFAULT_FROM = "Bike GR Calendar <notifications@bikegr.org>";

/** A subject is one line. A title from a form must not add a line to the message. */
function oneLine(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim();
}

export function createEmailTransport(options: TransportOptions = {}): EmailTransport {
  const env = options.env ?? process.env;
  const apiKey = env.RESEND_API_KEY;

  if (apiKey) {
    const resend = (options.resendFactory ?? ((key) => new Resend(key) as unknown as ResendLike))(apiKey);
    const from = env.EMAIL_FROM || DEFAULT_FROM;
    return {
      kind: "resend",
      async send(message) {
        const { error } = await resend.emails.send({ from, ...message, subject: oneLine(message.subject) });
        if (error) throw new Error("Resend could not send the email.");
      },
    };
  }

  // Vercel sets VERCEL=1 on every deployment. Its logs must never hold email content.
  if (env.VERCEL) {
    throw new Error("RESEND_API_KEY is not set. The console transport is not allowed on Vercel.");
  }
  const log = options.log ?? ((line: string) => console.info(line));
  return {
    kind: "console",
    async send(message) {
      log(`[email] to ${message.to.join(", ")}: ${oneLine(message.subject)}\n${message.text}`);
    },
  };
}

/** Test transport: keeps each message in `sent`. */
export function captureTransport(): EmailTransport & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    kind: "capture",
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
