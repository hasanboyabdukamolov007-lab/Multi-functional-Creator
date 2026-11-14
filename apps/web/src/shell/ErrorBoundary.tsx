import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate, useI18n } from "../lib/i18n";

interface Props {
  children: ReactNode;
  /** Changing this key resets the boundary (e.g. on navigation). */
  resetKey?: string;
  compact?: boolean;
}
interface State {
  error: Error | null;
  copied: boolean;
}

/** Keeps one broken module from blanking the whole panel. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Module crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, copied: false });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = (k: string) => translate(useI18n.getState().locale, k);
    return (
      <div className={this.props.compact ? "" : "page"} role="alert">
        <div className="card col" style={{ gap: 10, maxWidth: 560, margin: this.props.compact ? 12 : "40px auto" }}>
          <div className="card-title">{t("error.title")}</div>
          <p className="muted small">{t("error.body")}</p>
          <code className="small" style={{ whiteSpace: "pre-wrap", color: "var(--mfc-danger)" }}>{this.state.error.message}</code>
          <div className="row">
            <button className="btn btn-primary" onClick={() => this.setState({ error: null, copied: false })}>{t("error.retry")}</button>
            <button className="btn" onClick={() => window.location.reload()}>{t("error.reload")}</button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                const e = this.state.error!;
                const details = [`${e.name}: ${e.message}`, `URL: ${location.pathname}${location.search}`, `When: ${new Date().toISOString()}`, `Browser: ${navigator.userAgent}`, "", e.stack ?? ""].join("\n");
                void navigator.clipboard?.writeText(details).then(() => this.setState({ copied: true }));
              }}
            >
              {this.state.copied ? "✓" : t("error.copy")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
