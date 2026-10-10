/** The public Schedule status badge ("Cancelled", "Rescheduled from …"). */
export function Badge({ text }: { text: string }) {
  return (
    <span className="ml-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
      {text}
    </span>
  );
}
