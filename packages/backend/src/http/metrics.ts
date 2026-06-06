// Minimal RED-style request metrics (Rate, Errors, Duration) — spec §4.7. An
// in-process recorder exposed at /metrics; a real Prometheus/OTLP exporter plugs
// in later without changing call sites.
import type { Request, Response, NextFunction } from "express";

export class MetricsRecorder {
  private requests = 0;
  private errors = 0;
  private durationMsTotal = 0;
  private byClass: Record<string, number> = {};

  record(status: number, durationMs: number): void {
    this.requests += 1;
    this.durationMsTotal += durationMs;
    if (status >= 500) this.errors += 1;
    const cls = `${Math.floor(status / 100)}xx`;
    this.byClass[cls] = (this.byClass[cls] ?? 0) + 1;
  }

  snapshot(): { requests: number; errors: number; avg_ms: number; by_class: Record<string, number> } {
    return {
      requests: this.requests,
      errors: this.errors,
      avg_ms: this.requests ? Math.round((this.durationMsTotal / this.requests) * 100) / 100 : 0,
      by_class: { ...this.byClass },
    };
  }
}

export function metricsMiddleware(rec: MetricsRecorder) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on("finish", () => rec.record(res.statusCode, Date.now() - start));
    next();
  };
}
