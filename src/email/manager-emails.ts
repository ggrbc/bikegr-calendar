/** The email to an existing account that gets a manager grant. Pure; every value is escaped. */
import { linkParagraph, paragraph } from "./html";
import type { ComposedEmail } from "./submission-emails";

export function composeManagerGrantEmail(input: { title: string; signInUrl: string }): ComposedEmail {
  const intro = `An Editor gave you access to "${input.title}". You can cancel a date, add a note, and add the route or conditions.`;
  const signature = "Bike GR Calendar — Greater Grand Rapids Bicycle Coalition";
  return {
    subject: `You can now manage ${input.title}`,
    text: `${intro}\n\nSign in: ${input.signInUrl}\n\n${signature}\n`,
    html: `${paragraph(intro)}${linkParagraph("Sign in", input.signInUrl)}${paragraph(signature)}`,
  };
}
