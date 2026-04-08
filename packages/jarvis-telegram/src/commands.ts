import { ChannelStore } from '@jarvis/runtime'
import {
  getStatus,
  getCrmTop5,
  triggerAgent,
  handleApproval,
  getHelpText,
} from './command-handlers.js'
import { handleFreeText, type ChatContext } from './chat-handler.js'

export type CommandContext = {
  channelStore?: ChannelStore
  threadId?: string
  telegramMessageId?: string
  chatId?: string
  sender?: string
}

export async function handleCommand(text: string, ctx?: CommandContext): Promise<string> {
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase() ?? ''
  const arg = parts[1] ?? ''

  // Slash commands — fast path, no LLM needed
  if (cmd.startsWith('/')) {
    const handlerCtx = {
      channelStore: ctx?.channelStore,
      threadId: ctx?.threadId,
      telegramMessageId: ctx?.telegramMessageId,
      sender: ctx?.sender,
    }

    switch (cmd) {
      case '/status': return getStatus()
      case '/crm': return getCrmTop5()
      case '/orchestrator': return triggerAgent('orchestrator', text, handlerCtx)
      case '/reflect': return triggerAgent('self-reflection', text, handlerCtx)
      case '/regulatory': return triggerAgent('regulatory-watch', text, handlerCtx)
      case '/knowledge': return triggerAgent('knowledge-curator', text, handlerCtx)
      case '/proposal': return triggerAgent('proposal-engine', text, handlerCtx)
      case '/evidence': return triggerAgent('evidence-auditor', text, handlerCtx)
      case '/contract': return triggerAgent('contract-reviewer', text, handlerCtx)
      case '/staffing': return triggerAgent('staffing-monitor', text, handlerCtx)
      case '/approve': return handleApproval(arg, 'approved', handlerCtx)
      case '/reject': return handleApproval(arg, 'rejected', handlerCtx)
      case '/help': return getHelpText()
      default: return `Unknown command: ${cmd}\n\nSend /help for available commands.`
    }
  }

  // Free-text — relay through Jarvis API with thread-scoped durable history.
  // All agent triggers must come via explicit /slash commands, not from LLM output.
  const chatCtx: ChatContext = {
    channelStore: ctx?.channelStore,
    threadId: ctx?.threadId,
  }
  const { text: reply } = await handleFreeText(text, chatCtx)
  return reply
}
