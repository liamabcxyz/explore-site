"use client";

import { useEffect } from "react";
import PropTypes from "prop-types";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import BetaBadge from "@/components/shared/BetaBadge";
import { installGlobalErrorHandlers } from "@/lib/errorReport";

// Root-level chrome that every route needs:
//   - `window` error / unhandledrejection handlers, so uncaught
//     exceptions outside React tree still route through the reporter
//   - top-level React <ErrorBoundary> so a component crash renders
//     a recoverable message instead of a white screen
//   - <BetaBadge> for version visibility + feedback entry
//
// Kept as a separate client component (not stuffed into app/layout.jsx)
// because the root layout is a Server Component; useEffect + class
// components need the "use client" boundary this file provides.
export default function AppShell({ children }) {
  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);
  return (
    <>
      <ErrorBoundary name="page">{children}</ErrorBoundary>
      <BetaBadge />
    </>
  );
}

AppShell.propTypes = {
  children: PropTypes.node,
};
