"use client";

/**
 * The Event description editor: a toolbar like Tockify's, over Tiptap, reading and writing Markdown
 * with the allowed set of src/agenda/description-markdown.ts. Only the allowed nodes and marks are
 * loaded, so pasted rich text cannot bring others. It does not report a change until the person
 * edits, so an untouched description is saved byte for byte.
 */
import { Markdown } from "@tiptap/markdown";
import { type ChainedCommands, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { isLinkUrl } from "@/agenda/safe-url";

const LINK_ERROR = "Use a web address that starts with http://, https://, or mailto:.";

const contentClass =
  "min-h-40 px-4 py-3 outline-none [&_a]:text-brand-orange-text [&_a]:underline [&_h1]:font-chivo [&_h1]:text-[22px] [&_h2]:font-chivo [&_h2]:text-[19px] [&_hr]:my-4 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6";
const buttonClass =
  "min-w-9 rounded px-2 py-1 text-sm hover:bg-black/5 disabled:opacity-40 aria-pressed:bg-black/10 aria-pressed:font-semibold";

export function MarkdownEditor({
  label,
  value,
  onChange,
  name,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  boxClassName = "rounded-[6px] border border-[#858486] bg-white",
}: {
  label: string;
  value?: string;
  onChange?: (markdown: string) => void;
  name?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  boxClassName?: string;
}) {
  const [markdown, setMarkdown] = useState(value ?? "");
  const lastEmitted = useRef(value ?? "");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const attributes = {
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": label,
    class: contentClass,
    ...(id ? { id } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(invalid ? { "aria-invalid": "true" } : {}),
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ["mailto"],
          isAllowedUri: (url) => isLinkUrl(url),
        },
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    content: value ?? "",
    contentType: "markdown",
    editorProps: { attributes },
    onUpdate: ({ editor }) => {
      const next = editor.getMarkdown();
      lastEmitted.current = next;
      setMarkdown(next);
      onChange?.(next);
    },
  });

  // A new value from outside (a form reset after Save) reloads the editor, without a change event.
  useEffect(() => {
    if (!editor || value === undefined || value === lastEmitted.current) return;
    lastEmitted.current = value;
    setMarkdown(value);
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id, describedBy, invalid, label]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  function openLink() {
    setLinkHref(editor?.getAttributes("link").href ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const href = linkHref.trim();
    if (!isLinkUrl(href)) {
      setLinkError(LINK_ERROR);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.setLink({ href }).run();
    setLinkOpen(false);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

  function onLinkKey(event: KeyboardEvent<HTMLInputElement>) {
    // The editor can sit inside a <form>: Enter applies the link, it does not send the form.
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") setLinkOpen(false);
  }

  const run = (command: (chain: ChainedCommands) => ChainedCommands) => () => {
    if (editor) command(editor.chain().focus()).run();
  };

  const tool = (labelText: string, glyph: string, onClick: () => void, pressed?: boolean, disabled?: boolean) => (
    <button
      type="button"
      className={buttonClass}
      aria-label={labelText}
      title={labelText}
      aria-pressed={pressed}
      disabled={!editor || disabled}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
  const divider = <span aria-hidden="true" className="mx-1 h-5 w-px bg-black/15" />;

  return (
    <div className={boxClassName}>
      <div
        role="toolbar"
        aria-label={`${label} formatting`}
        className="flex flex-wrap items-center gap-1 border-b border-black/10 px-2 py-1"
      >
        {tool("Undo", "↶", run((c) => c.undo()), undefined, !state?.canUndo)}
        {tool("Redo", "↷", run((c) => c.redo()), undefined, !state?.canRedo)}
        {divider}
        {tool("Heading 1", "H1", run((c) => c.toggleHeading({ level: 1 })), state?.h1)}
        {tool("Heading 2", "H2", run((c) => c.toggleHeading({ level: 2 })), state?.h2)}
        {divider}
        {tool("Bold", "B", run((c) => c.toggleBold()), state?.bold)}
        {tool("Italic", "I", run((c) => c.toggleItalic()), state?.italic)}
        {divider}
        {tool("Bulleted list", "•", run((c) => c.toggleBulletList()), state?.bullet)}
        {tool("Numbered list", "1.", run((c) => c.toggleOrderedList()), state?.ordered)}
        {divider}
        {tool("Link", "Link", openLink, state?.link)}
        {divider}
        {tool("Horizontal line", "—", run((c) => c.setHorizontalRule()))}
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-2 py-2">
          <input
            type="url"
            aria-label="Link address"
            className="min-w-0 flex-1 rounded border border-[#858486] px-2 py-1 text-sm"
            placeholder="https://"
            value={linkHref}
            autoFocus
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={onLinkKey}
          />
          <button type="button" className={buttonClass} onClick={applyLink}>
            Apply
          </button>
          {state?.link && (
            <button type="button" className={buttonClass} onClick={removeLink}>
              Remove link
            </button>
          )}
          <button type="button" className={buttonClass} onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
          {linkError && (
            <p role="alert" className="w-full text-sm text-brand-orange-text">
              {linkError}
            </p>
          )}
        </div>
      )}
      {editor ? <EditorContent editor={editor} /> : <div className="min-h-40" aria-hidden="true" />}
      {name && <input type="hidden" name={name} value={markdown} />}
    </div>
  );
}
