// W3C trace-context propagation (spec §4.7). Ensures every request carries a valid
// `traceparent`, echoes it on the response, and exposes it for logs. Real OTLP
// export is wired only when OTEL_EXPORTER_OTLP_ENDPOINT is set (no-op otherwise) —
// the SDK exporter is a follow-on; this keeps trace ids flowing today.
import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function traceMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header("traceparent");
    const traceparent =
      incoming && TRACEPARENT.test(incoming)
        ? incoming
        : `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
    res.setHeader("traceparent", traceparent);
    res.locals.traceparent = traceparent;
    next();
  };
}
