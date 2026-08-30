import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class AdminErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Do not render stack traces or tokens into the portal. The console entry
    // remains available to authorized developers during local diagnostics.
    console.error("SemiTraX admin recovered from a render failure", error, info);
  }

  render() {
    if (this.state.failed) {
      return <main className="center-state">
        <section className="login-card">
          <span className="eyebrow orange">RECOVERY MODE</span>
          <h2>This admin view could not finish loading</h2>
          <p>Your session remains protected. Reload the portal to retry.</p>
          <button className="primary-button" onClick={() => window.location.reload()}>Reload portal</button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Admin root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode><AdminErrorBoundary><App /></AdminErrorBoundary></React.StrictMode>,
);
