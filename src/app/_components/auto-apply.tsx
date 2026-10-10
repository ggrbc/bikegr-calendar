"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { parseFilters, serializeFilters } from "@/agenda/filters";
import type { LocalDate } from "@/engine";

/**
 * Applies the filter form at once (Tockify behavior): a change of a day or Tag checkbox, or of a
 * date, goes to the new URL with a client-side navigation. The search applies on Enter (the form's
 * submit). The URL comes from the same parser and serializer as the server, so it is the canonical
 * form. Without JavaScript this does nothing, and the form's Apply button submits the GET form.
 */
export function AutoApply({ formId, action, today }: { formId: string; action: string; today: LocalDate }) {
  const router = useRouter();

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    const apply = () => {
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form)) {
        if (typeof value === "string" && value !== "") params.append(key, value);
      }
      const query = serializeFilters(parseFilters(params, today), today);
      router.push(query ? `${action}?${query}` : action, { scroll: false });
    };
    const onChange = (event: Event) => {
      const target = event.target;
      // The search box applies on Enter only, not on each key.
      if (target instanceof HTMLInputElement && target.type !== "search") apply();
    };
    const onSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      apply();
    };

    form.addEventListener("change", onChange);
    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("change", onChange);
      form.removeEventListener("submit", onSubmit);
    };
  }, [formId, action, today, router]);

  return null;
}
