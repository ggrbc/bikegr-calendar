"use client";

import { useEffect } from "react";
import { EMBED_ROOT_ID, LOCATION_MESSAGE, RESIZE_MESSAGE } from "@/embed/protocol";

/**
 * In the Embed iframe: reports the height of the embed root element to the host page (so the host
 * script sets the iframe height), and the canonical filter query (so the host script can put it in
 * the host URL). It measures the root element, not <html>: the root layout gives <html> the full
 * iframe height, so that height would never shrink.
 */
export function ResizeReporter({ search }: { search: string }) {
  // Chrome does not hydrate an off-screen cross-origin iframe (for example a second Embed below a
  // long first one) until it scrolls into view. Until then, that iframe keeps its start height.
  useEffect(() => {
    if (window.parent === window) return;
    const root = document.getElementById(EMBED_ROOT_ID);
    if (!root) return;
    let last = -1;
    const post = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (Math.abs(height - last) < 1) return;
      last = height;
      window.parent.postMessage({ type: RESIZE_MESSAGE, height }, "*");
    };
    const observer = new ResizeObserver(post);
    observer.observe(root);
    post();
    window.parent.postMessage({ type: LOCATION_MESSAGE, search }, "*");
    return () => observer.disconnect();
  }, [search]);
  return null;
}
