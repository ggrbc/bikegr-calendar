/** The public Schedule status badge ("Cancelled", "Rescheduled from …"), a small pill. */
export function Badge({ text }: { text: string }) {
  return (
    <span className="ml-2 inline-block rounded-[300px] bg-amber-100 px-3 py-0.5 align-middle font-sans text-xs font-normal text-amber-900">
      {text}
    </span>
  );
}
