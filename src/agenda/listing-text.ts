/**
 * The short text of an Occurrence for the agenda card and page metadata: the Custom Preview when
 * the Event has one, else the start of the description as plain text. One line.
 */
import { descriptionText } from "./description-markdown";
import { excerpt } from "./description-text";
import type { AgendaRow } from "./occurrence-rows";

export function listingText(row: Pick<AgendaRow, "preview" | "description">, length: number): string {
  return excerpt(row.preview ?? descriptionText(row.description), length);
}
