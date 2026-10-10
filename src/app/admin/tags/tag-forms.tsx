"use client";

import { useActionState } from "react";
import type { CalendarSlug } from "@/engine";
import {
  addTagAction,
  mergeTagAction,
  renameTagAction,
  setTagRetiredAction,
  type TagFormState,
} from "./actions";

const idle: TagFormState = { result: "idle" };

const input = "rounded border border-gray-400 px-2 py-1";
const button = "rounded border border-gray-500 px-3 py-1 disabled:opacity-60";

function Message({ state }: { state: TagFormState }) {
  if (state.result === "error") {
    return (
      <p role="alert" className="text-sm text-red-700">
        {state.message}
      </p>
    );
  }
  if (state.result === "ok") {
    return (
      <p role="status" className="text-sm text-green-800">
        {state.message}
      </p>
    );
  }
  return null;
}

export function AddTagForm({ calendar }: { calendar: CalendarSlug }) {
  const [state, action, pending] = useActionState(addTagAction, idle);
  const id = `add-tag-${calendar}`;
  return (
    <form action={action} className="mb-4 flex flex-col gap-2">
      <input type="hidden" name="calendar" value={calendar} />
      <label htmlFor={id} className="font-medium">
        New Tag
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={id} name="name" required maxLength={40} className={input} />
        <button type="submit" disabled={pending} className="rounded bg-blue-700 px-3 py-1 font-medium text-white disabled:opacity-60">
          {pending ? "Adding…" : "Add Tag"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export interface TagRowProps {
  tag: { id: string; name: string; slug: string; retired: boolean; eventCount: number };
  /** Other active Tags of the same Calendar. */
  mergeTargets: { id: string; name: string }[];
}

/** The rename, retire or unretire, and merge controls of one Tag. */
export function TagActions({ tag, mergeTargets }: TagRowProps) {
  const [renameState, renameAction, renaming] = useActionState(renameTagAction, idle);
  const [retireState, retireAction, retiring] = useActionState(setTagRetiredAction, idle);
  const [mergeState, mergeAction, merging] = useActionState(mergeTagAction, idle);

  function confirmMerge(event: React.FormEvent<HTMLFormElement>) {
    const select = event.currentTarget.elements.namedItem("targetId") as HTMLSelectElement | null;
    const targetName = select?.selectedOptions[0]?.text ?? "the other Tag";
    const events = `${tag.eventCount} Event${tag.eventCount === 1 ? "" : "s"}`;
    const question = `Move ${events} from "${tag.name}" to "${targetName}" and retire "${tag.name}"? This cannot be undone.`;
    if (!window.confirm(question)) event.preventDefault();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <details>
          <summary className="cursor-pointer underline">Rename</summary>
          <form action={renameAction} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="tagId" value={tag.id} />
            <label className="sr-only" htmlFor={`rename-${tag.id}`}>
              New name for {tag.name}
            </label>
            <input id={`rename-${tag.id}`} name="name" defaultValue={tag.name} required maxLength={40} className={input} />
            <button type="submit" disabled={renaming} className={button}>
              Save
            </button>
          </form>
        </details>

        <form action={retireAction}>
          <input type="hidden" name="tagId" value={tag.id} />
          <input type="hidden" name="retire" value={tag.retired ? "no" : "yes"} />
          <button type="submit" disabled={retiring} className={button}>
            {tag.retired ? "Unretire" : "Retire"}
          </button>
        </form>

        {mergeTargets.length > 0 && (
          <details>
            <summary className="cursor-pointer underline">Merge into…</summary>
            <form action={mergeAction} onSubmit={confirmMerge} className="mt-2 flex flex-wrap gap-2">
              <input type="hidden" name="tagId" value={tag.id} />
              <label className="sr-only" htmlFor={`merge-${tag.id}`}>
                Merge {tag.name} into
              </label>
              <select id={`merge-${tag.id}`} name="targetId" required className={input}>
                {mergeTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={merging} className={button}>
                Merge
              </button>
            </form>
          </details>
        )}
      </div>
      <Message state={renameState} />
      <Message state={retireState} />
      <Message state={mergeState} />
    </div>
  );
}
