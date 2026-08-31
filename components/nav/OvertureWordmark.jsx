import Link from "next/link";
import PropTypes from "prop-types";

// File still named OvertureWordmark for backward-compat with the Header
// import path — the actual brand it renders is VANTAGE, matching the
// landing page (app/page.jsx) and the browser title (app/layout.jsx). Kept
// as its own component so re-branding again later is a one-file change.
// The OMF logo image the old Overture Explorer wordmark carried is gone
// on purpose — this app isn't the OMF's data explorer any more.
export default function OvertureWordmark({ href = "/" }) {
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

OvertureWordmark.propTypes = {
  href: PropTypes.string,
};
