import Link from "next/link";
import type { GrantRow } from "@/admin/events/managers";
import { Badge, Card, linkClass, mutedClass } from "../../_components/ui";

/**
 * The Events an Event manager manages, with links to each Event (where an Editor changes the
 * grants). A Deleted Event shows a badge: the grant stays and has no effect until a Restore.
 */
export function ManagesList({ grants }: { grants: GrantRow[] }) {
  return (
    <Card title="Manages" titleId="manages-heading">
      {grants.length === 0 ? (
        <p className={mutedClass}>This person manages no Events now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.map((grant) => (
            <li key={grant.eventId} className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
              <Link href={`/admin/events/${grant.eventId}`} className={linkClass}>
                {grant.title}
              </Link>
              {grant.deleted && <Badge tone="deleted">Deleted</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
