import type { ReactNode } from "react";
import { type Block, descriptionBlocks, type Inline } from "@/agenda/description-markdown";

/**
 * The Event description (Markdown, the allowed set in description-markdown.ts) as React elements,
 * so it is never read as HTML. Description headings are one and two levels below the page title.
 */
const linkClass = "break-all font-normal text-brand-orange-text underline underline-offset-4";

function renderInlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "break":
        return <br key={i} />;
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {renderInlines(node.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInlines(node.children)}</em>;
      case "link":
        return (
          <a key={i} href={node.href} className={linkClass} rel="nofollow noopener noreferrer">
            {renderInlines(node.children)}
          </a>
        );
    }
  });
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <p key={key}>{renderInlines(block.children)}</p>;
    case "heading":
      return block.level === 1 ? (
        <h2 key={key} className="font-chivo text-[22px] font-normal leading-snug">
          {renderInlines(block.children)}
        </h2>
      ) : (
        <h3 key={key} className="font-chivo text-[19px] font-normal leading-snug">
          {renderInlines(block.children)}
        </h3>
      );
    case "list": {
      const items = block.items.map((item, i) => <li key={i}>{item.map(renderBlock)}</li>);
      return block.ordered ? (
        <ol key={key} start={block.start} className="list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-6">
          {items}
        </ul>
      );
    }
    case "rule":
      return <hr key={key} className="border-brand-divider" />;
  }
}

export function RichText({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = descriptionBlocks(markdown);
  if (blocks.length === 0) return null;
  return <div className={className}>{blocks.map(renderBlock)}</div>;
}
