import Link from "next/link";
import PropTypes from "prop-types";

// The VANTAGE brand strip in the header. Kept as its own component so
// re-branding (a proper logo image, a wider header, a per-route
// variant) is a one-file change.
export default function Wordmark({ href = "/" }) {
  const isInternal = href.startsWith("/");
  const style = {
    display: "flex",
    alignItems: "center",
    textDecoration: "none",
    color: "inherit",
    letterSpacing: "0.08em",
    fontWeight: 700,
    fontSize: "1.1rem",
  };
  const contents = <span className="tour-homepage">VANTAGE</span>;

  if (isInternal) {
    return (
      <Link href={href} className="wordmark" style={style} aria-label="Back to city search">
        {contents}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="wordmark"
      style={style}
    >
      {contents}
    </a>
  );
}

Wordmark.propTypes = {
  href: PropTypes.string,
};
