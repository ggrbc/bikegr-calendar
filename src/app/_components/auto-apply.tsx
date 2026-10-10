"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { DAYS_BACK_LIMIT, DAYS_FORWARD_LIMIT, parseFilters, serializeFilters } from "@/agenda/filters";
import { addDays, type LocalDate } from "@/engine";

export const RESULTS_ID = "agenda-results";

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PAUSE_MS = 800;

/**
 * Applies the filter form at once (Tockify behavior). The URL comes from the same parser and
 * serializer as the server, so it is the canonical form. Without JavaScript this does nothing, and
 * the form's Apply button submits the GET form.
 *
 * - A day or Tag checkbox: a new history entry (`router.push`), so Back undoes it.
 * - A date: Chrome fires `change` for each part the rider types (month, day, each year digit), and
 *   each can be a whole date already. So a date applies when the field loses focus, on Enter, or
 *   0.8 s after the last change (for the date picker), only when the value is a whole date in the
 *   allowed range, and with `router.replace`, so typing does not fill the history.
 * - The search: on Enter (the form's submit).
 * - When the canonical query changes (a filter applied, or Back and Forward), the form is reset to
 *   the server's values, so the boxes always match the URL.
 * - While the navigation loads, the result list has `aria-busy` and is dimmed.
 */
export function AutoApply({
  formId,
  action,
  today,
  query,
}: {
  formId: string;
  action: string;
  today: LocalDate;
  /** The canonical query of the page that rendered this form. */
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Back and Forward: the browser keeps the boxes the rider touched; reset to the URL's state.
  useEffect(() => {
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) form.reset();
  }, [formId, query]);

  useEffect(() => {
    const results = document.getElementById(RESULTS_ID);
    if (!results) return;
    if (pending) results.setAttribute("aria-busy", "true");
    else results.removeAttribute("aria-busy");
  }, [pending]);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const earliest = addDays(today, -DAYS_BACK_LIMIT);
    const latest = addDays(today, DAYS_FORWARD_LIMIT);

    let dateTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = (mode: "push" | "replace") => {
      clearTimeout(dateTimer);
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form)) {
        if (typeof value === "string" && value !== "") params.append(key, value);
      }
      const next = serializeFilters(parseFilters(params, today), today);
      const href = next ? `${action}?${next}` : action;
      // Nothing changed (for example a blur right after the pause applied the same date).
      if (href === `${window.location.pathname}${window.location.search}`) return;
      startTransition(() => {
        if (mode === "push") router.push(href, { scroll: false });
        else router.replace(href, { scroll: false });
      });
    };
    const dateReady = (input: HTMLInputElement) =>
      input.value === "" || (FULL_DATE.test(input.value) && input.value >= earliest && input.value <= latest);

    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type === "checkbox") apply("push");
      else if (target.type === "date") {
        clearTimeout(dateTimer);
        if (dateReady(target)) dateTimer = setTimeout(() => apply("replace"), DATE_PAUSE_MS);
      }
      // The search box applies on Enter only, not on each key.
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "date" && dateReady(target)) apply("replace");
    };
    const onSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      apply("push");
    };

    form.addEventListener("change", onChange);
    form.addEventListener("focusout", onFocusOut);
    form.addEventListener("submit", onSubmit);
    return () => {
      clearTimeout(dateTimer);
      form.removeEventListener("change", onChange);
      form.removeEventListener("focusout", onFocusOut);
      form.removeEventListener("submit", onSubmit);
    };
  }, [formId, action, today, router]);

  return null;
}
