# Event managers share the Editor account table

Group leaders need to post the route, the conditions, and weather cancellations for the dates of their
own ride. We give them an **Event manager** account: a row in `editors` with the role `event_manager`,
and a grant table `event_managers` that links the person to the Events they manage. They sign in the
same way as an Editor (magic link, Google), and an Admin deactivates them in the same way, which also
ends their sessions. `requireEditor` and `requireAdmin` refuse the role, so every Editor page and
server action is closed to them by default. Only My Events, the date form of a managed Event, and the
account page are open.

## Considered options

- **A separate account type (its own table, its own login).** Rejected: a second Auth.js user table
  and a second set of invite, Deactivate, and session-revocation code. The Auth.js adapter works with
  one user table. Two tables would double the places where "who is signed in" can be wrong.
- **Secret edit links per Event, with no account.** Rejected: a link cannot be turned off for one
  person, it is forwarded and posted, and the history cannot name who changed a date. There is no
  Deactivate and no revoke.
- **Give group leaders the Editor role.** Rejected: an Editor changes every Event, deletes Events, and
  reviews Submissions. The leader of one ride should change only that ride's dates.

## Consequences

- The role check is fail-closed in one place (src/auth/dal.ts). A new page or action that calls
  `requireEditor` is closed to Event managers with no extra code. A test lists every page and action
  from the file system and fails for one that has no guard.
- The database cannot check that a grant belongs to an `event_manager` account (a CHECK cannot read
  another table). The write code checks it. When an Admin makes an Event manager an Editor, the grants
  stay with no effect.
- A manager writes an Override or the Event row with only three columns, so an Editor's change to the
  same date stays. A manager's write bumps the Event `version`, so an Editor's open form shows the
  normal conflict message.
- "Event manager" is not a choice in the role select or the invite form. A person becomes one only
  through a grant, so there is no manager with no Event by accident.
