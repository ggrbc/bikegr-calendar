# The Event description is Markdown, edited in a toolbar editor

Tockify had a toolbar editor for the description, and Editors and Submitters expect one. We store
the description as Markdown in the same text column and edit it with Tiptap and its Markdown
extension. The page parses it with `marked`, the parser the extension uses, with the same options
(`gfm`, `breaks`), maps it to a small tree of allowed kinds, and renders React elements. Anything
outside the allowed set stays literal text, so the page never reads a description as HTML.
Existing plain-text descriptions read as Markdown look the same (checked against the Tockify
export), so there is no migration.

## Considered options

- **Sanitized HTML.** Closest to Tockify, and would allow underline and alignment. It needs a
  sanitizer on every write and render, a data migration, and HTML-to-text for the Feed and
  metadata. We did not want underline or alignment, so the cost bought nothing.
- **A Markdown textarea with a toolbar.** Lightest, but people see `**` and `#`; a step back from
  Tockify.

## Consequences

- The editor and the page must parse alike: `marked` is pinned to the major version that
  `@tiptap/markdown` uses, with the same options. GFM bare-URL autolinks are off in the page parser;
  bare `http`/`https` addresses become links the same way as in the Occurrence details. The editor
  writes `&`, `<`, and `>` as entities, so the page reads those entities back as characters.
- One known difference: raw HTML tags in stored text (only from a hand-made POST) show as literal
  text on the page, but the editor loads them as formatting, so the next save turns them into
  Markdown. Nothing is ever rendered as HTML.
- The forms refuse Markdown that nests lists or quotes too deep for the parser; the page falls back
  to plain paragraphs if one gets through.
- The editor does not report a change until the person edits, so opening an old plain-text
  description and saving other fields stores it byte for byte, and loading a Submission is not an
  unsaved change.
- The database stores Markdown text, so a future editor or a sanitized-HTML view can read it with
  no migration.
