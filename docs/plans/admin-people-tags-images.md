# Plan — Admin: people, Tags, and images

Stream: `admin-people-tags-images`. Milestone: "Admin" in [build-plan.md](../build-plan.md). Terms
follow [CONTEXT.md](../../CONTEXT.md). Branch `admin-people-tags-images`, from `admin-nav-shell`
(PR #5); rebase on `main` when PR #5 merges.

## Context

The admin shell has placeholder pages for Tags and Editors. This stream builds them, and the image
upload module that the parallel `admin-event-editing` stream puts in the Event form. No Event
editing here. **No schema change** is necessary: every column that this plan uses exists.

## Items

- `tag-management` — `/admin/tags`: add, rename (slug stays), merge (same Calendar), retire and
  unretire, Event count per Tag.
- `editor-management` — `/admin/editors` (Admins only): list, invite (moved here), change role,
  deactivate (sessions revoked), reactivate.
- `image-upload-resize` — `src/admin/images/**`: server module, server action, and a client field
  component for the Event form. `sharp` resize to WebP, stored in Vercel Blob.

## Decision for Jeremy — upload size (blocks `image-upload-resize`)

The brief says "max 10 MB". Two platform limits make a 10 MB **server** upload fail on Vercel:

1. A Vercel Function accepts a request body of **4.5 MB** at most (the `@vercel/blob` README says the
   same for server uploads). This limit is in the platform, not in Next.js.
2. Next.js 16 server actions accept **1 MB** by default (`experimental.serverActions.bodySizeLimit`).

A direct browser-to-Blob upload ("client upload") avoids limit 1, but `@vercel/blob/client` signs
its token with `BLOB_READ_WRITE_TOKEN` only. We use OIDC, so it does not work without a new secret.

Options:

- **A (recommended) — shrink in the browser when necessary, then `sharp` on the server.** The field
  accepts a file up to 10 MB. If the file is larger than 4 MB, the browser draws it at max 1600 px
  wide and sends that (WebP if the browser can encode WebP, else JPEG at quality 0.9). The server
  always runs `sharp` (real type check, orientation, metadata strip, 1600 px, WebP). Server limit:
  4 MB of file; `bodySizeLimit: "4.5mb"`. One change outside my scope: `next.config.ts`.
- **B — 4 MB limit, no browser step.** Simpler. An Editor with a large phone photo gets "Image is
  larger than 4 MB" and must make it smaller.
- **C — client upload of the original to Blob, then a server resize.** True 10 MB. Needs
  `BLOB_READ_WRITE_TOKEN` in Vercel, a token route, and cleanup of the temporary originals.

The rest of this plan uses **A**. With B, the browser step goes away; nothing else changes.

## Other changes outside my file scope (each needs a go)

| File | Change | Why |
|---|---|---|
| `next.config.ts` | `experimental.serverActions.bodySizeLimit: "4.5mb"` | upload action (all options) |
| `src/app/admin/actions.ts` | remove `inviteEditorAction` and `InviteState` (they move to `src/app/admin/editors/actions.ts`); `signOutAction` stays | the invite form moves; the moved action also revalidates `/admin/editors` |
| `src/auth/editors.ts` | invite of a deactivated address: "Reactivation is not available yet." → "Reactivate them in the Editors list." | reactivation exists now |

If you refuse the `actions.ts` change: the form moves, the action stays, and the form calls
`router.refresh()` after a sent invite.

## Module layout

```
src/admin/tags/
  rules.ts            parseTagName(raw) -> ParseResult<{ name, slug }>   (pure)
  tags.ts             listTagsForAdmin(db, calendar), listPickerTags(db, calendar),
                      addTag, renameTag, mergeTags, retireTag, unretireTag
  rules.test.ts, tags.test.ts
src/admin/editors/
  rules.ts            checkRoleChange(...), checkDeactivate(...), checkReactivate(...)  (pure)
  editors.ts          listEditorsForAdmin(db), changeEditorRole, deactivateEditor, reactivateEditor
  rules.test.ts, editors.test.ts
src/admin/images/
  process-image.ts    toEventWebp(bytes, { maxInputPixels }) -> { bytes, width, height }  (sharp)
  upload-image.ts     uploadEventImage(bytes, { store }) -> UploadResult   (size, type, resize,
                      hash, head, put)
  limits.ts           MAX_UPLOAD_BYTES, MAX_SELECT_BYTES, MAX_WIDTH, ACCEPT; shared by server and client
  image-url.ts        isEventImageUrl(url) — our Blob host and the `events/` path (for the Event stream)
  shrink-in-browser.ts  shrinkForUpload(file) (client only); targetSize(w, h, max) (pure)
  actions.ts          "use server": uploadEventImageAction(formData)
  image-upload-field.tsx  "use client": <ImageUploadField />
  process-image.test.ts, upload-image.test.ts, image-url.test.ts, shrink-in-browser.test.ts
src/app/admin/tags/
  page.tsx            replaces the placeholder; one section per Calendar, inside <Suspense>
  actions.ts          thin server actions (requireEditor)
  tag-forms.tsx       "use client": add, rename, merge, retire/unretire forms (useActionState)
src/app/admin/editors/
  page.tsx            replaces the placeholder; invite form and Editor list, inside <Suspense>
  actions.ts          thin server actions (requireAdmin); inviteEditorAction moved here
  invite-form.tsx     moved from src/app/admin/invite-form.tsx
  editor-forms.tsx    "use client": role, deactivate, reactivate forms
src/app/admin/page.tsx  remove the invite section (the link list stays)
```

Reuse, no copies: `tagSlug` from `src/import/calendar-and-tags.ts`; `BlobStore`, `blobCredentials`,
`vercelBlobStore`, `isBlobUrl` from `src/import/images.ts`.

All module functions take `db: Db` first (PGlite in tests) and return
`{ ok: true, … } | { ok: false; reason: "<code>"; error: "<message for the Editor>" }`, as
`inviteEditor` does. Each write is one `db.transaction`. Server actions: auth check, parse
`FormData`, call the module, `revalidatePath`, return a small state object for `useActionState`.

## Tags (`tag-management`)

### Rules

- **Name:** trim, collapse inner white space, 1–40 characters. Its slug (`tagSlug`) must not be
  empty ("Use at least one letter or number.").
- **Add:** the slug comes from the name. A duplicate slug in that Calendar is refused. If the
  duplicate is retired, the message says "Unretire it instead."
- **Rename:** changes the name only; the slug stays, so shared filter links keep working. Refused if
  another **active** Tag of that Calendar has the same name (case-insensitive). This is a check in
  the transaction, not a constraint (no schema change); a race can make two equal names, which is
  harmless.
- **Retire / unretire:** retired Tags keep their `event_tags` links. The public agenda already hides
  them (`load-occurrences.ts` filters `retired_at is null`); `listPickerTags` hides them too.
  Unretire sets `retired_at` and `retired_by` to null.
- **Every write** sets `updated_at` and `updated_by`; add sets `created_by`; retire sets `retired_by`.
- **Event count:** Events linked to the Tag that are not deleted (`deleted_at is null`), any Review
  status.

### Transactions

- `addTag(db, editorId, { calendar, name })` — one statement:
  `insert … on conflict (calendar, slug) do nothing returning *`. No row → select the existing Tag
  for the message. Safe under concurrency: the unique constraint decides.
- `renameTag(db, editorId, { tagId, name })` — `select … for update` the Tag; check the name rule
  against the other Tags of its Calendar; `update name, updated_*`.
- `retireTag` / `unretireTag` — one conditional `update … where id = ? and retired_at is [not] null
  returning`. No row → select to tell "not found" from "already retired / already active".
- `mergeTags(db, editorId, { sourceId, targetId })` — see below.

### Merge algorithm (Tag A into Tag B)

In one transaction:

1. Refuse `A = B`.
2. `select … from tags where id in (A, B) order by id for update`. The fixed order prevents a
   deadlock between two merges. `for update` also waits for any open Event save that links A or B
   (the FK insert holds `for key share` on the Tag row), and makes later link inserts wait for the
   merge.
3. Refuse when a Tag is missing, when A and B have different Calendars, or when B is retired
   ("Unretire B first, or merge into an active Tag."). A may be retired.
4. `insert into event_tags (event_id, tag_id, calendar) select event_id, B, calendar from event_tags
   where tag_id = A on conflict (event_id, tag_id) do nothing` — an Event that has both A and B gets
   one B link, not two.
5. `delete from event_tags where tag_id = A`.
6. Retire A: `retired_at = coalesce(retired_at, now())`, `retired_by`, `updated_*`. A is kept (no
   hard delete), so its slug stays reserved; a filter link with A's slug shows no results, as
   design.md says.
7. Return the counts: links moved, duplicates dropped.

The database also refuses a cross-Calendar link by itself: the `event_tags` composite FK
`(tag_id, calendar) → tags(id, calendar)` fails for a Tag of the other Calendar. A test proves it.

A merge does not write `event_history` and does not change `events.version`: it is a Tag change,
and the Tag row records who did it. Trade-off: an Event's history does not show the Tag change.

### Contract for the Event stream

- `listPickerTags(db, calendar)` — active Tags of one Calendar, sorted by name: `{ id, name, slug }`.
- On an Event save, a Tag that is retired and that the Event did not have before must not be linked
  (an open form can show a Tag that was retired or merged after the form loaded). Links the Event
  already had stay.

### Page

`/admin/tags`: one section per Calendar ("Rides & Events", "Advocacy"). Each section: the add form,
then a table: name, slug, Events, status, and actions — rename (inline), retire or unretire, and
"Merge into…" (a select of the other active Tags of that Calendar, then a confirm step: "Move N
Events from A to B and retire A? This cannot be undone."). Retired Tags show below the active ones.

Tag actions call `revalidatePath` for `/admin/tags`, `/admin/events`, `/`, `/rides`, `/advocacy`.
(The agenda is dynamic now; the calls keep it correct if it gets a cache later.)

## Editors (`editor-management`)

### Rules (pure, in `rules.ts`)

- The actor must be an active Admin (checked again in the transaction, from the database: a
  `requireAdmin()` at the start of the request can be stale).
- An Admin cannot deactivate themself or change their own role.
- The last active Admin cannot be deactivated or demoted.
- Role change and deactivation of a deactivated Editor are refused ("Reactivate first.").
- Reactivate: only a deactivated Editor. The role stays as it was. They sign in again at `/login`.
- Never hard-delete.

### "Last active Admin" under concurrency

With the self rule, an active Admin actor and a different target, two active Admins exist. So the
last-Admin rule can only fail in a race: Admins X and Y demote each other at the same time; each
transaction sees two Admins; both commit; zero Admins.

Fix: every Editor role/deactivate/reactivate transaction starts with
`select pg_advisory_xact_lock(<one constant key>)`. The writes run one at a time. Postgres runs
in READ COMMITTED, so each statement after the lock sees what the earlier transaction committed.
Then the transaction reads the actor and the target, and counts the active Admins. In the race, the
second transaction sees that its actor is no longer an Admin and refuses. The lock is released at
commit or rollback. Invites do not take the lock: an invite never removes an Admin.

Alternative: `select … where role = 'admin' and deactivated_at is null for update`. It also works,
but its correctness depends on the re-check that Postgres does on rows that a concurrent
transaction changed. The advisory lock is easier to read and to review.

PGlite has one connection, so tests cannot run two transactions in parallel. The tests cover the
rule (pure tests with counts) and the sequence (after X demotes Y, Y cannot act).

### Transactions

- `changeEditorRole(db, actorId, { editorId, role })` — lock; read actor and target; count active
  Admins; `checkRoleChange`; `update role`. Same role → ok, no write.
- `deactivateEditor(db, actorId, { editorId })` — lock; read; `checkDeactivate`;
  `update deactivated_at = now(), deactivated_by = actor`;
  `delete from auth_sessions where user_id = target` (access stops at once; `getCurrentEditor`
  already refuses a deactivated Editor on every request, so this is a second guard and it ends the
  session); `delete from auth_verification_tokens where identifier = target email` (unused magic
  links).
- `reactivateEditor(db, actorId, { editorId })` — lock; read; `checkReactivate`;
  `update deactivated_at = null, deactivated_by = null`.

The `editors` table has no role-change audit columns; `deactivated_by` is the only audit. No schema
change in this stream.

### List

`listEditorsForAdmin(db)`: name, email, role, Active or "Deactivated <date> by <name>", "Invited by
<name> on <date>" (or "Seeded" when `invited_by` is null), **First sign-in** (`email_verified`), and
**Last active**. There is no "last sign-in" column. Last active = latest `auth_sessions.expires`
minus 30 days (the Auth.js session `maxAge`; Auth.js moves `expires` at most once in 24 hours), so it
is correct to one day. Blank when no session row exists (signed out or expired). Shown as a date
only, with the label "Last active (about)". Sort: active first, then by name or email.

### Page

`/admin/editors` (`requireAdmin`): the invite form (moved), then the table. Each row: role select +
"Change role", "Deactivate" (confirm step), or "Reactivate". The current Admin's own row shows no
role or deactivate controls ("You"). Actions call `revalidatePath("/admin/editors")`.

## Images (`image-upload-resize`)

### Server flow — `uploadEventImageAction(formData)` in `src/admin/images/actions.ts`

1. `requireEditor()`.
2. `formData.get("file")` must be a `File`; size 1 byte … 4 MB (`MAX_UPLOAD_BYTES`).
3. Store: `blobCredentials(process.env)` null → "Image upload is not set up." Else
   `vercelBlobStore()` (OIDC first, then a read-write token; the import's logic).
4. `uploadEventImage(new Uint8Array(await file.arrayBuffer()), { store })`:
   1. `toEventWebp(bytes)` with `sharp`:
      - `sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })` — refuses a
        decompression bomb before decode.
      - `metadata().format` must be `jpeg`, `png`, `gif`, `webp`, or `heif` with AV1 compression
        (AVIF). The decoded type decides, not the browser's MIME type. SVG, HEIC, TIFF, and non-images
        are refused.
      - `.rotate()` (EXIF orientation), `.resize({ width: 1600, withoutEnlargement: true })`,
        `.webp({ quality: 82 })`, `.toBuffer({ resolveWithObject: true })`. `sharp` drops
        metadata (GPS) by default. An animated GIF or WebP keeps its first frame only.
   2. Path `events/<sha256 of the WebP bytes>.webp`.
   3. `store.head(path)`; found → its URL. Else `store.put(path, bytes, "image/webp")`
      (`access: "public"`, `addRandomSuffix: false`, in `vercelBlobStore`).
5. Return `{ ok: true, url, width, height }` or `{ ok: false, error }`. No `revalidatePath`: an
   upload changes no page; the Event save does.

**Buffer, not stream:** the file is at most 4 MB; `sharp` and the SHA-256 need all bytes; the path
needs the hash before the `put`. **Where `sharp` runs:** in the server action, in the Node.js
runtime of the Vercel Function. `sharp` is in Next.js's default `serverExternalPackages`, so the
bundler does not bundle it. `sharp.cache(false)`, so a function instance does not keep image memory.

### `sharp` install

`sharp` 0.35 has no install script; its binaries come from `@img/sharp-<os>-<cpu>` optional
packages (`@img/sharp-linux-x64` on Vercel). Steps: add `sharp` to `dependencies` (it is now only a
Next.js optional dependency); remove `sharp` from `ignoredBuiltDependencies` in
`pnpm-workspace.yaml`; check that `pnpm-lock.yaml` lists `@img/sharp-linux-x64`; run `pnpm build`.
I cannot deploy (no push); a Vercel preview of the PR confirms the Linux binary.

### Browser step (option A) — `shrinkForUpload(file)`

Runs only when the file is over 4 MB and at most 10 MB: `createImageBitmap(file)` → canvas at
`targetSize(w, h, 1600)` → `canvas.toBlob("image/webp", 0.9)`; if the browser returns another type
(older Safari), `toBlob("image/jpeg", 0.9)`. A decode failure shows "This image cannot be read. Try
a JPEG or PNG." Transparency is lost only in the JPEG fallback.

### Client component interface (for the Event stream)

```tsx
import { ImageUploadField } from "@/admin/images/image-upload-field";

<ImageUploadField
  name="imageUrl"                 // hidden input name; default "imageUrl"
  defaultValue={event.imageUrl}   // string | null; shows the current image
  label="Image"                   // default "Image"
  onUploadingChange={setBusy}     // optional; true while an upload runs (disable Save)
  onChange={(url) => …}           // optional; the new URL, or null after "Remove"
/>
```

- Renders: a label, a file input **with no `name`** (the file never goes with the Event form), a
  preview `<img>`, a "Remove image" button, a hidden `<input name={name}>` with the URL (empty
  string when there is no image), and a status line (`role="status"`: "Uploading…", or
  `role="alert"`: the error).
- Upload starts when a file is picked: browser checks (type in `ACCEPT`, ≤ 10 MB), the browser
  step, then `uploadEventImageAction`. Server actions give no byte progress, so the progress is the
  "Uploading…" state and a disabled input. A failed upload keeps the earlier URL.
- `accept="image/jpeg,image/png,image/gif,image/webp,image/avif"`, so iOS converts a HEIC photo
  to JPEG when the Editor picks it.
- The Event save must check the URL with `isEventImageUrl(url)` (our Blob host, `events/` path) or
  accept the URL already stored on the Event (an imported image). The component does not prove it.

## Test cases

All database tests use PGlite (`createTestDb`), next to the module.

### Tag rules and writes

- Tag name is trimmed, inner spaces collapsed, and the slug comes from `tagSlug`
- Tag name with no letters or numbers is refused
- Tag name over 40 characters is refused
- Add creates a Tag with its slug, `created_by`, and `updated_by`
- Add refuses a duplicate slug in the same Calendar
- Add refuses a duplicate slug of a retired Tag and says to unretire it
- Add allows the same slug in the other Calendar
- Rename changes the name and keeps the slug
- Rename refuses a name that another active Tag of that Calendar has
- Rename allows a name that only a Tag of the other Calendar has
- Retire keeps the Event links and sets `retired_at` and `retired_by`
- Retire of a retired Tag is refused as "already retired"
- Unretire clears `retired_at` and `retired_by`
- Picker list has only active Tags of the one Calendar, sorted by name
- Admin list counts Events per Tag and does not count deleted Events
- Merge moves every link of A to B and retires A
- Merge of an Event that has both A and B leaves one B link
- Merge refuses A and B of different Calendars and changes nothing
- Merge refuses a retired target
- Merge of a retired source works
- Merge of a Tag into itself is refused
- Merge of a missing Tag is refused
- Database refuses an Event-Tag link to a Tag of the other Calendar (composite FK)

### Editor rules and writes

- Role change by a non-Admin is refused
- Admin cannot change their own role
- Admin cannot deactivate themself
- Last active Admin cannot be demoted (pure rule with an Admin count of one)
- Last active Admin cannot be deactivated (pure rule)
- Role change of a deactivated Editor is refused
- Admin promotes an Editor to Admin
- Admin demotes another Admin when two active Admins exist
- After X demotes Y, Y cannot demote X (the actor is read again in the transaction)
- Deactivated Admin cannot act with a stale session check
- Deactivate sets `deactivated_at` and `deactivated_by` and keeps the row
- Deactivate deletes that Editor's sessions and unused magic-link tokens, and no other Editor's
- Deactivate of a deactivated Editor is refused
- Reactivate clears `deactivated_at` and `deactivated_by` and keeps the role
- Reactivate of an active Editor is refused
- Editor list shows inviter name, "Seeded" for no inviter, first sign-in, and last active from the
  latest session
- Editor list shows no last active when the Editor has no session

### Image upload

- Large PNG is resized to 1600 px wide WebP, height in proportion (real `sharp`)
- Small image is not upscaled (real `sharp`)
- JPEG, GIF, WebP, and AVIF inputs become WebP (real `sharp`, generated images)
- SVG bytes are refused although `sharp` can read SVG
- Bytes that are not an image are refused
- Image over the pixel limit is refused before decode
- EXIF orientation is applied and metadata is removed
- File over 4 MB is refused before `sharp` runs
- Empty file is refused
- Stored path is `events/<sha256 of the WebP>.webp` with content type `image/webp`
- Same image a second time: `head` finds it and nothing is `put`
- No Blob credentials gives "Image upload is not set up"
- `isEventImageUrl` accepts our Blob host with `events/` and refuses other hosts and paths
- `targetSize` keeps the aspect ratio and never upscales

UI components have no unit tests (Vitest runs in Node, `*.test.ts` only). I check them by hand on
the dev server (Neon dev, Blob OIDC) and with screenshots.

## Task order (test-first, one commit or more per step)

1. `sharp` dependency and `pnpm-workspace.yaml`; `pnpm build` passes.
2. Tag rules: tests, then `rules.ts`.
3. Tag writes: tests on PGlite, then `tags.ts` (add, rename, retire/unretire, lists, merge).
4. Tags page, actions, forms; manual check.
5. Editor rules: tests, then `rules.ts`.
6. Editor writes: tests, then `editors.ts` (lock, role, deactivate, reactivate, list).
7. Editors page; move the invite form and action; remove the invite section from
   `src/app/admin/page.tsx`; the `src/auth/editors.ts` message; manual check.
8. Image processing: real-`sharp` tests, then `process-image.ts`.
9. Upload: tests with a fake `BlobStore`, then `upload-image.ts`, `image-url.ts`, `limits.ts`.
10. `next.config.ts` body limit; server action; `shrink-in-browser.ts`; `ImageUploadField`; manual
    upload on the dev server (Blob dev store), then remove the test blob if possible.
11. `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`; report.

## Out of scope

Event editing, the Event form, `event_history` writes, settings, per-Calendar Editor access, a
role-change audit trail, and Tag aliases (a redirect from a merged Tag's slug).
