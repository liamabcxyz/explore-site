"use client";

import { Component } from "react";
import PropTypes from "prop-types";
import { Box, Button, Stack, Typography } from "@mui/material";
import { reportError } from "@/lib/errorReport";

// React error boundaries have to be class components — the hook API
// intentionally doesn't cover this case. Keep it small: catch,
// report, render a minimal recover-or-report UI.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // `info.componentStack` is the React tree at the failure point —
    // very helpful for narrowing "which part broke" beyond the JS
    // stack alone.
    reportError(error, {
      source: "react",
      boundary: this.props.name || "root",
      componentStack: info?.componentStack ?? null,
    });
  }

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error?.message ?? String(this.state.error);
    return (
      <Box
        sx={{
          p: 3,
          maxWidth: 480,
          mx: "auto",
          my: 4,
          border: "1px solid",
          borderColor: "error.main",
          borderRadius: 2,
          bgcolor: "background.paper",
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h6" color="error.main">
            Something broke
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {this.props.name
              ? `The ${this.props.name} panel crashed.`
              : "The page crashed while rendering."}{" "}
            The error has been reported automatically. You can reload to try
            again — if it keeps happening, please send feedback with what you
            were doing.
          </Typography>
          <Typography
            variant="caption"
            component="pre"
            sx={{
              p: 1,
              bgcolor: "action.hover",
              borderRadius: 1,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 11,
              maxHeight: 160,
            }}
          >
            {message}
          </Typography>
          <Button variant="contained" onClick={this.handleReload}>
            Reload
          </Button>
        </Stack>
      </Box>
    );
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node,
  name: PropTypes.string,
};
