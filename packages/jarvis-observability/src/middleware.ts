/**
 * Express middleware for exposing Prometheus metrics endpoint.
 */

import { getMetricsText, getMetricsContentType } from "./metrics.js";
import type { Request, Response } from "express";

/**
 * Returns an Express request handler that serves Prometheus metrics.
 * Mount at `/metrics` in the dashboard API.
 *
 * @example
 * app.get("/metrics", metricsEndpoint());
 */
export function metricsEndpoint(): (req: Request, res: Response) => void {
  return (_req: Request, res: Response) => {
    getMetricsText()
      .then((text) => {
        res.set("Content-Type", getMetricsContentType());
        res.end(text);
      })
      .catch((err) => {
        res.status(500).end(`Error collecting metrics: ${(err as Error).message}`);
      });
  };
}
