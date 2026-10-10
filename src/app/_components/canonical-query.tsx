"use client";

import { useEffect } from "react";

/**
 * After a filter form submit, the URL has every field (`q=&from=…&to=…`). This replaces it with the
 * canonical query (same filters, defaults left out), so shared links are short. No navigation.
 */
export function CanonicalQuery({ query }: { query: string }) {
  useEffect(() => {
    const wanted = query ? `?${query}` : "";
    if (window.location.search !== wanted) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${wanted}`);
    }
  }, [query]);
  return null;
}
