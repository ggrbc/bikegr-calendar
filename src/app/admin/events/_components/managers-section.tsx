import type { ManagerRow } from "@/admin/events/managers";
import { Badge, Card, hintClass, mutedClass } from "../../_components/ui";
import { AddManagerForm, RemoveManagerForm } from "./manager-forms";

const STATUS_LABELS: Record<ManagerRow["status"], string> = {
  invited: "Invited",
  "no-effect": "Editor (no effect)",
  active: "Active",
  deactivated: "Deactivated",
};

/**
 * The Managers section of the Event edit page (approved, not deleted Events only). An Event manager
 * changes the Occurrences of this Event: the Schedule status, the Schedule note, and the Occurrence
 * details. Nothing else.
 */
export function ManagersSection({ eventId, managers }: { eventId: string; managers: ManagerRow[] }) {
  return (
    <Card title="Managers" titleId="managers-heading">
      <p className={`${hintClass} mb-4`}>
        An Event manager can cancel or confirm a date, add a note, and add the route or conditions for a
        date. They cannot change anything else of this Event.
      </p>
      {managers.length === 0 ? (
        <p className={`${mutedClass} mb-4`}>No managers yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-brand-divider" aria-label="Managers">
          {managers.map((manager) => (
            <li key={manager.editorId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="font-semibold">{manager.name ?? manager.email}</p>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={mutedClass}>{manager.email}</span>
                  <Badge tone="neutral">{STATUS_LABELS[manager.status]}</Badge>
                </p>
              </div>
              <RemoveManagerForm eventId={eventId} editorId={manager.editorId} label={manager.name ?? manager.email} />
            </li>
          ))}
        </ul>
      )}
      <AddManagerForm eventId={eventId} />
    </Card>
  );
}
