export { initTelemetry, shutdownTelemetry, getTracer, getMeter, type TelemetryConfig } from "./setup.js";
export {
  recordJobMetrics,
  getMetricsText,
  getMetricsContentType,
  jobDurationSeconds,
  jobTotal,
  workerHealthRatio,
  queueDepth,
  activeAgentRuns,
  modelLatencySeconds,
  ragRetrievalSeconds,
  embeddingChunksTotal,
  knowledgeDocumentsTotal,
  approvalFunnelTotal,
  provenanceRecordsTotal,
  webhookIngressTotal,
  inferenceRuntimeTotal,
  sessionModeTotal,
  browserBridgeTotal,
  taskflowRunsTotal,
  memoryBoundaryViolationsTotal,
  inferenceCostUsdTotal,
  inferenceLocalPercentage,
  dreamingRunsTotal,
  dreamingSynthesisTotal,
  wikiRetrievalTotal,
  legacyPathTraffic,
} from "./metrics.js";
export { withJobSpan, withDbSpan, currentTraceId } from "./span-helpers.js";
export { metricsEndpoint } from "./middleware.js";
export {
  ProvenanceSigner,
  hashContent,
  type ProvenanceRecord,
} from "./provenance.js";
