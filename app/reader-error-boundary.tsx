"use client";

import { Component, type ReactNode } from "react";

type ReaderErrorBoundaryProps = {
  children: ReactNode;
};

type ReaderErrorBoundaryState = {
  hasError: boolean;
};

export default class ReaderErrorBoundary extends Component<
  ReaderErrorBoundaryProps,
  ReaderErrorBoundaryState
> {
  state: ReaderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ReaderErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="reader-status reader-status-error">
          The entered URL could not be loaded as a Thorium publication. If this is an
          OPDS feed, pick a specific publication/manifest URL from the feed instead.
        </div>
      );
    }

    return this.props.children;
  }
}
