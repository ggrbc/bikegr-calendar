/**
 * An email address that breaks only before the "@" (`name<wbr>@example.org`), never inside a word.
 * `overflow-wrap: anywhere` helps only when one part alone is wider than the screen.
 */
export function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@");
  return (
    <span className="[overflow-wrap:anywhere]">
      {at < 1 ? (
        email
      ) : (
        <>
          {email.slice(0, at)}
          <wbr />
          {email.slice(at)}
        </>
      )}
    </span>
  );
}
