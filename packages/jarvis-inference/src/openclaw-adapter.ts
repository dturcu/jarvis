/**
 * openclaw-adapter.ts — Adapter wrapping openclaw infer (Epic 5).
 *
 * Provides a unified inference interface that routes through the OpenClaw
 * gateway when available, falling back to direct local runtime access.
 *
 * Design rule: stateless + provider-backed work -> infer adapter;
 * domain-stateful + approval-sensitive -> Jarvis worker calling infer.
 */

import {
  invokeGatewayMethod,
  type GatewayCallOptions,
} from '@jarvis/shared'

// ---- Types ----------------------------------------------------------------

export interface InferenceRequest {
  prompt: string
  model?: string
  maxTokens?: number
  temperature?: number
  json?: boolean
  allowOpenclaw?: boolean
}

export interface InferenceResponse {
  text: string
  model: string
  runtime: 'ollama' | 'lmstudio' | 'openclaw'
  tokens_used?: number
  latency_ms: number
}

export interface InferenceRoutingDecision {
  selected_model: string
  selected_runtime: string
  reason: string
  candidates_considered: number
  timestamp: string
}

export interface OpenClawModelInfo {
  id: string
  runtime: 'openclaw'
  capabilities: string[]
  parameters?: string
}

// ---- Adapter ---------------------------------------------------------------

export class OpenClawInferAdapter {
  private readonly overrides: GatewayCallOptions

  constructor(overrides: GatewayCallOptions = {}) {
    this.overrides = overrides
  }

  /**
   * Run a completion through the OpenClaw inference surface.
   * Falls back to a descriptive error if the gateway is unreachable.
   */
  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    const start = Date.now()

    try {
      const result = await invokeGatewayMethod<Record<string, unknown>>(
        'inference.complete',
        undefined,
        {
          prompt: request.prompt,
          model: request.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          json: request.json,
        },
        this.overrides,
      )

      return {
        text: String(result.text ?? result.content ?? result.reply ?? ''),
        model: String(result.model ?? request.model ?? 'unknown'),
        runtime: 'openclaw',
        tokens_used: typeof result.tokens_used === 'number' ? result.tokens_used : undefined,
        latency_ms: Date.now() - start,
      }
    } catch (err) {
      throw new Error(
        `OpenClaw inference failed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Ensure the OpenClaw gateway is running and supports inference.complete.',
      )
    }
  }

  /**
   * List models available through the OpenClaw gateway.
   */
  async listModels(): Promise<OpenClawModelInfo[]> {
    try {
      const result = await invokeGatewayMethod<{ models?: Array<Record<string, unknown>> }>(
        'inference.list_models',
        undefined,
        {},
        this.overrides,
      )

      return (result.models ?? []).map((m) => ({
        id: String(m.id ?? m.name ?? ''),
        runtime: 'openclaw' as const,
        capabilities: Array.isArray(m.capabilities) ? m.capabilities.map(String) : [],
        parameters: m.parameters ? String(m.parameters) : undefined,
      }))
    } catch {
      return [] // Gateway unavailable — no OpenClaw models
    }
  }

  /**
   * Generate embeddings through the OpenClaw gateway.
   */
  async embed(texts: string[]): Promise<number[][]> {
    const result = await invokeGatewayMethod<{ embeddings?: number[][] }>(
      'inference.embed',
      undefined,
      { texts },
      this.overrides,
    )

    return result.embeddings ?? []
  }

  /**
   * Search the web through the OpenClaw gateway.
   */
  async search(query: string, maxResults = 5): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const result = await invokeGatewayMethod<{ results?: Array<Record<string, unknown>> }>(
      'inference.web_search',
      undefined,
      { query, max_results: maxResults },
      this.overrides,
    )

    return (result.results ?? []).map((r) => ({
      title: String(r.title ?? ''),
      url: String(r.url ?? r.link ?? ''),
      snippet: String(r.snippet ?? r.description ?? ''),
    }))
  }

  /**
   * Transcribe audio through the OpenClaw gateway.
   */
  async transcribe(params: {
    audioUrl?: string
    audioBase64?: string
    language?: string
  }): Promise<{ text: string; language: string; duration_seconds?: number }> {
    const result = await invokeGatewayMethod<Record<string, unknown>>(
      'inference.audio_transcribe',
      undefined,
      params,
      this.overrides,
    )

    return {
      text: String(result.text ?? result.transcription ?? ''),
      language: String(result.language ?? params.language ?? 'en'),
      duration_seconds: typeof result.duration_seconds === 'number' ? result.duration_seconds : undefined,
    }
  }

  /**
   * Generate speech from text through the OpenClaw gateway.
   */
  async tts(params: {
    text: string
    voice?: string
    format?: 'mp3' | 'wav' | 'opus'
  }): Promise<{ audioBase64: string; format: string; duration_seconds?: number }> {
    const result = await invokeGatewayMethod<Record<string, unknown>>(
      'inference.tts',
      undefined,
      params,
      this.overrides,
    )

    return {
      audioBase64: String(result.audio_base64 ?? result.audio ?? ''),
      format: String(result.format ?? params.format ?? 'mp3'),
      duration_seconds: typeof result.duration_seconds === 'number' ? result.duration_seconds : undefined,
    }
  }

  /**
   * Generate an image through the OpenClaw gateway.
   */
  async imageGenerate(params: {
    prompt: string
    size?: string
    model?: string
  }): Promise<{ imageBase64: string; model: string; revised_prompt?: string }> {
    const result = await invokeGatewayMethod<Record<string, unknown>>(
      'inference.image_generate',
      undefined,
      params,
      this.overrides,
    )

    return {
      imageBase64: String(result.image_base64 ?? result.image ?? ''),
      model: String(result.model ?? params.model ?? 'unknown'),
      revised_prompt: result.revised_prompt ? String(result.revised_prompt) : undefined,
    }
  }

  /**
   * Describe an image through the OpenClaw gateway.
   */
  async imageDescribe(params: {
    imageUrl?: string
    imageBase64?: string
    prompt?: string
  }): Promise<{ description: string; model: string }> {
    const result = await invokeGatewayMethod<Record<string, unknown>>(
      'inference.image_describe',
      undefined,
      params,
      this.overrides,
    )

    return {
      description: String(result.description ?? result.text ?? result.content ?? ''),
      model: String(result.model ?? 'unknown'),
    }
  }

  /**
   * Record a routing decision for observability.
   */
  static createRoutingDecision(
    selectedModel: string,
    selectedRuntime: string,
    reason: string,
    candidatesConsidered: number,
  ): InferenceRoutingDecision {
    return {
      selected_model: selectedModel,
      selected_runtime: selectedRuntime,
      reason,
      candidates_considered: candidatesConsidered,
      timestamp: new Date().toISOString(),
    }
  }
}
