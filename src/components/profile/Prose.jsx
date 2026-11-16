import RichText from "./RichText.jsx";

/** Free text out of a profile file, re-flowed to the column width, with
 *  its lists kept, ids turned into links and editorial asides subdued. */
export default function Prose({ text, className = "small" }) {
  return <RichText text={text} className={className} />;
}
