/**
 * Turnstile offline for e2e: a stub widget script gives a token, and the host server stands in for
 * siteverify (TURNSTILE_SITEVERIFY_URL). Each test sends from its own IP (`x-forwarded-for`), so the
 * per-IP limit of 3 an hour does not mix the tests.
 */
import type { Page } from "@playwright/test";

/** The Turnstile widget stub: each render and each reset gives a token after a short wait. */
function turnstileStub(token: string): string {
  return `window.turnstile = (() => {
    const widgets = {};
    const issue = (id) => setTimeout(() => widgets[id].callback(${JSON.stringify(token)}), 50);
    return {
      render(element, options) {
        const id = "w" + (Object.keys(widgets).length + 1);
        widgets[id] = options;
        element.textContent = "Spam check (e2e stub)";
        issue(id);
        return id;
      },
      reset(id) { issue(id); },
      remove(id) { delete widgets[id]; },
    };
  })();`;
}

export async function stubTurnstile(page: Page, ip: string, token = "e2e-token") {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: turnstileStub(token) }),
  );
}
