import { useContext } from "react";
import { parseBlocks, parseInline } from "../../lib/profileText.js";
import { ProfileLinkContext } from "./ProfileLinkContext.jsx";

export function Inline({ text }) {
  const { resolve } = useContext(ProfileLinkContext);
  return parseInline(text).map((t, i) => {
    switch (t.type) {
      case "bold":
        return <b key={i}>{t.text}</b>;
      case "code":
        return <code key={i} className="inline-code">{t.text}</code>;
      case "draft":
        return <span key={i} className="note note-draft">{t.text}</span>;
      case "note":
        return <span key={i} className="note">{t.text}</span>;
      case "id": {
        const target = resolve?.(t.text);
        return target
          ? <a key={i} className="id-chip id-link" href={target.hash} title={target.label}>{t.text}</a>
          : <code key={i} className="id-chip">{t.text}</code>;
      }
      default:
        return <span key={i}>{t.text}</span>;
    }
  });
}

/** Free text out of a profile file: paragraphs, lists, bold, code, ids as
 *  links, editorial asides subdued. */
export default function RichText({ text, className = "small" }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className={`prose rich ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === "p") return <p key={i}><Inline text={b.text} /></p>;
        if (b.type === "ul") {
          return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it.text} /></li>)}</ul>;
        }
        return (
          <ol key={i} className="rich-ol">
            {b.items.map((it, j) => (
              <li key={j}><span className="ol-marker">{it.marker}</span> <Inline text={it.text} /></li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
