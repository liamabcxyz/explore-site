import Link from "next/link";
import PropTypes from "prop-types";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function OvertureWordmark({ href = "https://overturemaps.org" }) {
  const isInternal = href.startsWith("/");
  const style = {
    display: "flex",
    alignItems: "center",
    textDecoration: "none",
    color: "inherit",
  };
  const contents = (
    <>
      <img
        src={`${basePath}/omf_logo_transparent.png`}
        alt={isInternal ? "" : "Overture Maps Foundation Logo"}
        className="logo"
        style={{ height: "2.5em", padding: "0.25em" }}
      />
      <b className="tour-homepage" style={{ whiteSpace: "nowrap" }}>Overture Explorer</b>
    </>
  );

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
