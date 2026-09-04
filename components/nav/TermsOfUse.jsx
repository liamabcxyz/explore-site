'use client';

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";

export default function TermsOfUse() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <button
          onClick={() => setOpen(true)}
          style={{
            pointerEvents: "auto",
            background: "rgba(0, 0, 0, 0.5)",
            color: "rgba(255, 255, 255, 0.7)",
            border: "none",
            borderRadius: "4px 4px 0 0",
            padding: "2px 12px",
            fontSize: "11px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Terms of Use
        </button>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Terms of Use</DialogTitle>
        <DialogContent dividers>
          <Typography paragraph variant="body2">
            VANTAGE is a fireworks-visibility estimator. It computes whether the
            geometric line of sight between a viewing spot and a launch point is
            clear of the buildings and terrain it knows about.
          </Typography>
          <Typography paragraph variant="body2">
            The analysis does <strong>not</strong> account for trees, temporary
            structures (scaffolding, construction cranes), weather, haze, or
            ambient light, and it cannot verify the actual location, altitude,
            or timing of any real fireworks display. Building height data has
            gaps and errors; terrain data is a global model, not surveyed.
            Treat every result as a guide, not a guarantee.
          </Typography>
          <Typography paragraph variant="body2" sx={{ fontWeight: 600 }}>
            VANTAGE IS PROVIDED AS-IS AND WITHOUT WARRANTIES OF ANY KIND. Do
            not use it for navigation, routing, or operational decisions.
          </Typography>
          <Typography paragraph variant="body2">
            The base map data is provided by the{" "}
            <Link href="https://overturemaps.org/" target="_blank" rel="noopener noreferrer">
              Overture Maps Foundation
            </Link>{" "}
            under the licenses of its upstream sources (OpenStreetMap and
            others). See Overture&apos;s{" "}
            <Link
              href="https://docs.overturemaps.org/attribution/"
              target="_blank"
              rel="noopener noreferrer"
            >
              attribution and licensing guide
            </Link>{" "}
            for details. Terrain elevation comes from{" "}
            <Link
              href="https://registry.opendata.aws/terrain-tiles/"
              target="_blank"
              rel="noopener noreferrer"
            >
              AWS Terrain Tiles
            </Link>
            . Address lookup on the &ldquo;here&rdquo; view is powered by{" "}
            <Link
              href="https://operations.osmfoundation.org/policies/nominatim/"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap Nominatim
            </Link>
            .
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
