/**
 * Convenience wrappers for tracing common operations.
 */

import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { getTracer } from "./setup.js";

/**
 * Wrap a job execution with a trace span.
 */
export async function withJobSpan<T>(
  jobType: string,
  jobId: string,
  attrs: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`job:${jobType}`, async (span) => {
    span.setAttributes({
      "jarvis.job.type": jobType,
      "jarvis.job.id": jobId,
      ...attrs,
    });

    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap a database operation with a trace span.
 */
export async function withDbSpan<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`db:${operation}`, async (span) => {
    span.setAttributes({ "db.operation": operation });
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the current trace ID for log correlation.
 */
export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  return ctx.traceId;
}
