/**
 * OpenTelemetry SDK initialization for the Jarvis runtime.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { trace, type Tracer, metrics, type Meter } from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

export type TelemetryConfig = {
  /** Prometheus scrape port (default: 9464) */
  prometheusPort?: number;
  /** Service name for traces (default: "jarvis") */
  serviceName?: string;
};

/**
 * Initialize the OpenTelemetry SDK with Prometheus exporter and HTTP instrumentation.
 * Call once at daemon startup. Safe to call multiple times (no-op after first).
 */
export function initTelemetry(config: TelemetryConfig = {}): void {
  if (sdk) return;

  const port = config.prometheusPort ?? 9464;

  sdk = new NodeSDK({
    serviceName: config.serviceName ?? "jarvis",
    metricReader: new PrometheusExporter({ port }),
    instrumentations: [new HttpInstrumentation()],
  });

  sdk.start();
}

/**
 * Gracefully shut down the OTel SDK. Call on process exit.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

/**
 * Get a named tracer for creating spans.
 */
export function getTracer(name = "jarvis"): Tracer {
  return trace.getTracer(name);
}

/**
 * Get a named meter for creating metrics.
 */
export function getMeter(name = "jarvis"): Meter {
  return metrics.getMeter(name);
}
