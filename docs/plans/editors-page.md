# Plan — Editors list, Editor edit page, rename

Stream: `editors-page`. Terms follow [CONTEXT.md](../../CONTEXT.md) (Editor, Admin). Branch
`editors-page`, from `origin/main`. Jeremy approved the goal; the open decisions below wait for his answers.

## Context

- The list on `/admin/editors` is crowded: 7 columns, dates that wrap, and a role select, "Change
  role", and "Deactivate" in each row. The email breaks inside a word ("grcodemonkey@gmai / l.com").
- Nobody can change a name after the invite. Jeremy: "remove columns from grid to make more room.
  Only show details on detail/edit screen" and "an editor should be able to change their own name too".
- No schema change and no migration. Auth.js config is not touched.

## Approach

- **List:** four columns only: Editor (name in bold, email under it), Role, Status (Active /
  Deactivated badge), and an "Edit" link-button. The current Admin's row also has "Edit". The stacked
  phone layout stays. The email breaks only before `@` (`<wbr>`, no `break-all`).
- **Edit page** `/admin/editors/[editorId]` (Admin only; `notFound()` for a bad or unknown id): back
  link, a "Details" card, one form (Name, Role, "Save"), and a separate Deactivate / Reactivate
  section with the current confirm dialog. On the Admin's own page, Name works; Role and Deactivate
  show as not available, with the reason (the current self rules).
- **Name rules:** one pure `parseEditorName(raw)` in `src/auth/rules.ts`: trim; empty becomes null;
  max 100 characters; refuse `\p{Cc}` and `\p{Cf}`. `parseInviteInput` uses it.
- **Rename write:** `renameEditor(db, actorId, { editorId, name })` in `src/admin/editors/editors.ts`,
  inside the same advisory-lock transaction. Pure rule `checkRename` in `rules.ts`: an active Admin
  renames anyone; any other active person renames only themselves; a deactivated actor is refused.
- **Account page** `/admin/account` for every signed-in person: email and role read only, Name field,
  "Save". The name (or email) in the admin header links to it. After Save, `revalidatePath` on the
  admin layout, so the header shows the new name.
- **Role labels:** one `ROLE_LABELS` map (role to label) in `src/admin/editors/rules.ts`, used by the
  list, the edit page, and the form. The `event-managers` stream adds one entry later.
- **Messages** on the edit page are the same as in the current `editor-forms.tsx`.

## Files to change

- `src/auth/rules.ts` (+ test): `parseEditorName`; `parseInviteInput` uses it.
- `src/admin/editors/rules.ts` (+ test): `checkRename`, `ROLE_LABELS`.
- `src/admin/editors/editors.ts` (+ test): `renameEditor`, `getEditorForAdmin(db, id)`.
- `src/app/admin/editors/page.tsx`: slim list. `editor-forms.tsx`: replaced by edit-page forms.
- `src/app/admin/editors/[editorId]/page.tsx` and `edit-forms.tsx`: new edit page.
- `src/app/admin/editors/actions.ts`: `renameEditorAction`, `saveEditorAction`; keep the others.
- `src/app/admin/account/page.tsx`, `account-form.tsx`, `actions.ts`: new account page.
- `src/app/admin/admin-nav.tsx`: header name links to `/admin/account`.
- `src/app/admin/_components/ui.tsx`: only if a small shared piece is needed (for example a field row).
- `e2e/editors.spec.ts`: new. `docs/design.md` "Editors". `.gitignore`: `.scratch/` if not there.

## Verification

- `pnpm test --hookTimeout=120000 --testTimeout=120000`; eslint on tracked files; `pnpm typecheck`;
  `DATABASE_URL= pnpm build`; `pnpm test:e2e` (own Docker Postgres).
- Screenshots of the list, the edit page, and the account page at 1280 and 375 px in `.scratch/`.

## Items

- `editors-list-declutter` — four-column list, Edit link-button on every row, email breaks only at `@`.
- `editor-edit-page` — Admin-only `/admin/editors/[editorId]` with Details, Name + Role + Save, and Deactivate / Reactivate.
- `editor-rename-write` — `renameEditor` plus pure `checkRename`, in the advisory-lock transaction, PGlite tests.
- `editor-name-rules` — pure `parseEditorName`, used by the invite form too, unit tests.
- `own-name-account-page` — `/admin/account` for every role; header name links to it.
- `editors-e2e` — Playwright specs and screenshots at 1280 and 375 px.
- `editors-docs` — `docs/design.md` "Editors" and this plan.

## Defaults I chose (no decision needed)

- An Admin may rename a deactivated Editor (the name is a record label, not access).
- A rename is not audited (no schema change). The Admin who renames is not stored.
- The edit page shows "Seeded" when no inviter is stored, as the list does now.
- After a Save, the form shows the same `role="status"` / `role="alert"` messages as today.
- A save on the edit page that changes only the Name does not call the role write, and the reverse.
- The invite form keeps its optional name; a name now has the 100-character limit.
- Existing names that break the new rules are not migrated. They show as they are; a save checks them.

## Open decisions

1. **Can a person clear their own name?** (Empty saves as null; the header then shows the email.)
   - A. Allow, as for the invite (name is optional). **Recommended:** matches today's data; one rule.
   - B. Require a name on the account page and the edit page; only the invite may leave it empty.
2. **One Save or two on the edit page when the role is not available (own page)?**
   - A. One "Save" form; the Role is a read-only line with the reason ("You cannot change your own
     role."). **Recommended:** simple, nothing to click that fails.
   - B. A disabled select with the reason under it.
3. **Does the Admin's own edit page differ from `/admin/account`?**
   - A. Both work; the Admin's own edit page also shows Details. **Recommended:** no special redirect.
   - B. The Admin's own "Edit" link goes to `/admin/account`.
