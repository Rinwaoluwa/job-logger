export default function ErrorBox({ children }) {
  if (!children) return null;
  return <div className="err-box">{children}</div>;
}
