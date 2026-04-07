import https from 'node:https'

type ChatMessage = { role: string; content: string }

function httpsPost(url: string, body: string, headers: Record<string, string>, timeoutMs = 30_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => (data += chunk.toString()))
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: data }))
      res.on('error', reject)
    })
    const timer = setTimeout(() => { req.destroy(new Error('timeout')) }, timeoutMs)
    req.on('error', (err) => { clearTimeout(timer); reject(err) })
    req.on('close', () => clearTimeout(timer))
    req.write(body)
    req.end()
  })
}

/**
 * Call Claude Messages API as a fallback when local LLM is unavailable.
 */
export async function claudeChat(messages: ChatMessage[], apiKey: string): Promise<string> {
  // Separate system message from conversation
  const systemMsg = messages.find(m => m.role === 'system')
  const conversationMsgs = messages.filter(m => m.role !== 'system')

  const reqBody = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemMsg?.content ?? '',
    messages: conversationMsgs.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  })

  const resp = await httpsPost(
    'https://api.anthropic.com/v1/messages',
    reqBody,
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    30_000,
  )

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Claude API error (${resp.status}): ${resp.body.slice(0, 200)}`)
  }

  const data = JSON.parse(resp.body) as {
    content?: Array<{ type: string; text?: string }>
  }

  return data.content?.find(c => c.type === 'text')?.text ?? 'No response from Claude.'
}
