# Plan — Editors list, Editor edit page, rename

Stream: `editors-page`. Terms follow [CONTEXT.md](../../CONTEXT.md) (Editor, Admin). Branch
`editors-page`, from `origin/main`. **Approved by Jeremy, 2026-10-10**, with the decisions in "Decisions" below.

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

## Decisions (Jeremy answered)

1. **The name is required (B).** On `/admin/account` and the edit page an empty name is refused
   ("Enter a name."). His reason: "Some people's emails have nothing to do with their name."
2. **The invite needs a name too.** `parseInviteInput` refuses an empty name; the invite field is
   required. `parseEditorName` returns a `ParseResult` and has no null result. All current Editors
   have names, so there is no data change.
3. **Role on the Admin's own edit page (C):** no Role at all, and no Deactivate / Reactivate
   section. Their own page has only the Details card and the Name form. (A deactivated Editor's page
   also has no Role select, with a note to reactivate first.)
4. **The Admin's own Edit link (A):** it goes to their own edit page, like every other row.

Changes to the Approach above: the name is never null (`parseEditorName` refuses empty text);
`checkRename` refuses with the new reason `not-allowed`; the edit page's Save writes the name first,
then the role, and if the role fails the message says "The name is saved."; `revalidatePath("/admin",
"layout")` clears the list, the edit pages, and the header.

## For the `event-managers` stream

The edit page is in small parts: `DetailsCard` (with `DetailRow`), `EditForm`, and `ActivationForm`
under `src/app/admin/editors/[editorId]/`. A "Manages" card can go between Details and the form
in `page.tsx`. `ROLE_LABELS` in `src/admin/editors/rules.ts` takes one new entry for
`event_manager`; the list, the Details card, the role select, and the account page all read it.

## `saveEditor` (added after review)

The edit page's Save is one domain write: `saveEditor(db, actorId, { editorId, name, nameWas, role?,
roleWas? })` in `src/admin/editors/editors.ts`.

- **One lock, one transaction, all or nothing.** Every check runs before the first write.
- **`*Was` fields.** The form posts hidden `nameWas` and `roleWas`: what it showed when it loaded.
  The server writes a field only when the posted value differs from its `*Was` value. A form that
  changes only the name never writes the role, and the reverse.
- **`stale` refusal.** For a field that changes, the stored value must still equal its `*Was` value.
  If not, the save is refused: "Another Admin changed this Editor. Reload the page." A stale form
  never undoes another change.
- **Nothing changed** returns ok with no write (checked after the actor is read).
- **Role rules** are the existing `checkRoleChange` (self, deactivated target, last Admin), so a
  forged role on the Admin's own page is refused with `self`.
- **Names** go through `parseEditorName`: trim, NFC, at least one letter, number, symbol, or
  punctuation mark, at most 100 code points, no control or invisible format characters (ZWNJ and ZWJ
  are allowed).
- The form keeps the typed text after a refusal (the action returns the posted values), and its
  field keys include the stored values.
