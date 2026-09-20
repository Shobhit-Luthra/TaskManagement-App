"use client";
import { Component, type ReactNode } from "react";

export class ChartErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <div className="text-muted-foreground rounded-xl border p-6 text-sm" role="alert">
          {this.props.label} could not be displayed. Reload the page to try again.
        </div>
      );
    }
    return this.props.children;
  }
}
