"use client";

/**
 * The Cloudflare Turnstile widget, rendered explicitly. The site key comes from the server as a
 * prop (no `NEXT_PUBLIC_` value). The token goes to the parent; the server checks it. A token works
 * once, so the parent gives a new `resetSignal` after each refused send to get a new one.
 */
import { useEffect, useRef } from "react";
import { TURNSTILE_ACTION } from "@/submissions/turnstile";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  resetSignal,
  onToken,
  onError,
}: {
  siteKey: string;
  /** A new non-null value resets the widget. */
  resetSignal: object | null;
  /** The token, or null when it expired or failed. */
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onError });

  useEffect(() => {
    callbacks.current = { onToken, onError };
  }, [onToken, onError]);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          "response-field": false,
          callback: (token: string) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(null),
          "error-callback": () => {
            callbacks.current.onToken(null);
            callbacks.current.onError("The spam check could not load. Reload the page and try again.");
          },
        });
      })
      .catch(() => callbacks.current.onError("The spam check could not load. Reload the page and try again."));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (!resetSignal || !widgetId.current || !window.turnstile) return;
    callbacks.current.onToken(null);
    window.turnstile.reset(widgetId.current);
  }, [resetSignal]);

  return <div ref={container} className="min-h-[65px]" />;
}
