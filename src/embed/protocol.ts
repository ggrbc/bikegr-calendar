/**
 * The Embed message protocol, iframe → host page only (design.md "Embed"). The iframe listens to no
 * messages. `public/embed.js` (plain JavaScript, no build step) has its own copy of these checks;
 * the Playwright tests cover both sides.
 *
 * - `resize`: the height of the embed root element, in CSS pixels.
 * - `location`: the canonical filter query of the iframe (no `?`), after each load, so the host
 *   script can put the filters in the host page URL.
 *
 * The iframe sends with target origin `"*"`: the data is public, and the iframe cannot know the host
 * origin for sure. The host script accepts a message only from the iframe's own origin and window.
 */

export const RESIZE_MESSAGE = "bikegr-calendar:resize";
export const LOCATION_MESSAGE = "bikegr-calendar:location";
export const MAX_HEIGHT = 50_000;
export const MAX_SEARCH_LENGTH = 2_000;
/** The filter keys that the host page URL can carry for the Embed. */
export const HOST_FILTER_KEYS = ["tag", "day", "q", "from", "to"] as const;
/** The id of the element that the iframe measures. */
export const EMBED_ROOT_ID = "bikegr-embed-root";

export type EmbedMessage =
  | { type: typeof RESIZE_MESSAGE; height: number }
  | { type: typeof LOCATION_MESSAGE; search: string };

/** The message, or null if it is not a valid Embed message. */
export function readEmbedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type === RESIZE_MESSAGE) {
    const { height } = message;
    if (typeof height !== "number" || !Number.isFinite(height) || height < 0 || height > MAX_HEIGHT) {
      return null;
    }
    return { type: RESIZE_MESSAGE, height };
  }
  if (message.type === LOCATION_MESSAGE) {
    const { search } = message;
    if (typeof search !== "string" || search.length > MAX_SEARCH_LENGTH) return null;
    return { type: LOCATION_MESSAGE, search };
  }
  return null;
}
