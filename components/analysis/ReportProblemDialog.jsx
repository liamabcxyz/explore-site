"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Stack,
  TextField,
  Typography,
  Button,
  Chip,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  Snackbar,
} from "@mui/material";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import { categoriesFor, MAX_ANNOTATIONS } from "@/lib/debug/annotations";
import { buildReportBundle, sendReport } from "@/lib/debug/bundle";

// User-visible strings live here so a non-technical language sweep can
// catch them at one grep. Nothing in this dialog says "sightline",
// "profile", "verdict", "minAlt", or "hit" — audience is somebody who
// installed the app to see if they can watch fireworks, not a developer.

// Three expected-result buttons. The dialog stores the machine slug in
// state; the label is what the user reads on the button.
const EXPECTED_RESULTS = [
  { id: "visible", label: "I should be able to see the fireworks", color: "#2e7d32" },
  { id: "partial", label: "I should see part of the fireworks", color: "#fbc02d" },
  { id: "blocked", label: "I really can't see anything", color: "#d32f2f" },
];

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function ReportProblemDialog({ open, onClose }) {
  const launch = useLaunchAnalysis() ?? {};
  const {
    analysis,
    viewerLevel,
    annotations = [],
    setAnnotations,
    annotationMode = false,
    setAnnotationMode,
  } = launch;

  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState(null);
  const [extraContext, setExtraContext] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState(null); // { kind: "ok"|"err", message }

  const canSend = description.trim().length > 0;

  const bundle = useMemo(
    () =>
      buildReportBundle({
        analysis,
        viewerLevel,
        user: { description: description.trim(), expected, extraContext: extraContext.trim() },
        annotations,
      }),
    [analysis, viewerLevel, description, expected, extraContext, annotations]
  );

  const handleSend = async (mode) => {
    try {
      await sendReport(bundle, { mode });
      setStatus({
        kind: "ok",
        message:
          mode === "download"
            ? "Report downloaded — send us the .json file."
            : "Report copied to your clipboard — paste it into your bug report.",
      });
      // Close a moment after success so the user sees the confirmation.
      setTimeout(() => {
        onClose();
        resetForm();
      }, 1400);
    } catch (err) {
      setStatus({ kind: "err", message: String(err?.message ?? err) });
    }
  };

  const resetForm = () => {
    setDescription("");
    setExpected(null);
    setExtraContext("");
    setShowPreview(false);
    setStatus(null);
    setAnnotations?.([]);
    setAnnotationMode?.(false);
  };

  const handleCancel = () => {
    setAnnotationMode?.(false);
    onClose();
  };

  const startAnnotation = () => {
    if (annotations.length >= MAX_ANNOTATIONS) return;
    setAnnotationMode?.(true);
    // We deliberately leave the dialog open — a modal Dialog blocks map
    // clicks — so callers pass `open={!annotationMode}` from the parent
    // to toggle it off while the pin is being placed. See ProfilePanel
    // for the wiring.
  };

  const removeAnnotation = (id) => {
    setAnnotations?.((prev) => prev.filter((a) => a.id !== id));
  };

  const updateAnnotationField = (id, patch) => {
    setAnnotations?.((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  return (
    <>
      <Dialog
        open={open && !annotationMode}
        onClose={handleCancel}
        maxWidth="sm"
        fullWidth
        aria-labelledby="report-dialog-title"
      >
        <DialogTitle id="report-dialog-title" sx={{ fontFamily: "Montserrat, sans-serif" }}>
          Something look wrong?
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3}>
            <Box>
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Tell us what you were expecting to see, versus what the app is telling you.
              </Typography>
              <TextField
                label="What went wrong?"
                placeholder="e.g. I can actually see the fireworks from my apartment, but this says 'blocked'"
                multiline
                minRows={3}
                fullWidth
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                What did you expect to see?
              </Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                value={expected}
                onChange={(_, v) => setExpected(v)}
                sx={{ flexWrap: "wrap" }}
              >
                {EXPECTED_RESULTS.map((opt) => (
                  <ToggleButton
                    key={opt.id}
                    value={opt.id}
                    sx={{
                      textTransform: "none",
                      borderLeftColor: opt.color,
                      borderLeftWidth: 4,
                      "&.Mui-selected": { bgcolor: `${opt.color}15` },
                    }}
                  >
                    {opt.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Point out what&apos;s wrong on the map (optional)
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
                Click a building that shouldn&apos;t be in the way, or a spot where something&apos;s missing (a tree, a small building). Up to {MAX_ANNOTATIONS}.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mb: 1 }}>
                {annotations.map((ann, i) => (
                  <Chip
                    key={ann.id}
                    label={`${i + 1}. ${ann.kind === "building" ? (ann.building?.name || "Building") : "Spot on the ground"}`}
                    onDelete={() => removeAnnotation(ann.id)}
                    color="error"
                    variant="outlined"
                    sx={{ mb: 1 }}
                  />
                ))}
              </Stack>
              {annotations.length > 0 && (
                <Stack spacing={2}>
                  {annotations.map((ann, i) => (
                    <Box key={ann.id} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {i + 1}. {ann.kind === "building" ? "This building" : "This spot"}
                        {ann.building?.name ? ` — "${ann.building.name}"` : ""}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", my: 1 }}>
                        {categoriesFor(ann.kind).map((cat) => (
                          <Chip
                            key={cat.id}
                            label={cat.label}
                            clickable
                            color={ann.category === cat.id ? "primary" : "default"}
                            variant={ann.category === cat.id ? "filled" : "outlined"}
                            onClick={() => updateAnnotationField(ann.id, { category: cat.id })}
                            size="small"
                            sx={{ mb: 1 }}
                          />
                        ))}
                      </Stack>
                      <TextField
                        placeholder="A note (optional)"
                        size="small"
                        fullWidth
                        value={ann.note}
                        onChange={(e) => updateAnnotationField(ann.id, { note: e.target.value })}
                      />
                    </Box>
                  ))}
                </Stack>
              )}
              <Button
                variant="outlined"
                size="small"
                onClick={startAnnotation}
                disabled={annotations.length >= MAX_ANNOTATIONS}
                sx={{ mt: 1, textTransform: "none" }}
              >
                {annotations.length === 0 ? "Click to mark something on the map" : `Mark another (${annotations.length}/${MAX_ANNOTATIONS})`}
              </Button>
            </Box>

            <TextField
              label="Anything else we should know? (optional)"
              placeholder="e.g. there's a big construction crane there this year; the fireworks show is at midnight so it'll be dark; the tree line changed"
              multiline
              minRows={2}
              fullWidth
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
            />

            <Alert severity="info" variant="outlined">
              Your report will include: the launch and viewing spot on the map, the firework size,
              what your device looks like, and the app&apos;s analysis. Coordinates you picked ARE included.
            </Alert>

            <Box>
              <Button size="small" onClick={() => setShowPreview((v) => !v)} sx={{ textTransform: "none" }}>
                {showPreview ? "Hide" : "Show"} what will be sent
              </Button>
              {showPreview && (
                <Box
                  component="pre"
                  sx={{
                    mt: 1,
                    p: 1.5,
                    bgcolor: "action.hover",
                    borderRadius: 1,
                    fontSize: 11,
                    overflow: "auto",
                    maxHeight: 260,
                    fontFamily: "monospace",
                  }}
                >
                  {JSON.stringify(bundle, null, 2)}
                </Box>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={() => handleSend("download")} disabled={!canSend}>
            Download as file
          </Button>
          <Button variant="contained" onClick={() => handleSend("clipboard")} disabled={!canSend}>
            Copy to clipboard
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={annotationMode && open}
        message="Click a building or a spot on the map to mark it"
        action={
          <Button color="inherit" size="small" onClick={() => setAnnotationMode?.(false)}>
            Cancel
          </Button>
        }
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      />

      <Snackbar
        open={Boolean(status)}
        autoHideDuration={3200}
        onClose={() => setStatus(null)}
        message={status?.message}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}

ReportProblemDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
