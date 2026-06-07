import type { ChatMessage, GroupMessageView, SenderInfo } from '../api'

export interface GroupSenderMeta {
  name: string
  color?: string | null
  avatar?: string | null
}

/** Build the bubble SenderInfo for a group message author. */
function resolveSender(
  view: GroupMessageView,
  members: Map<string, GroupSenderMeta>,
  currentUserName: string
): SenderInfo {
  if (view.senderRole === 'user') {
    return { id: 'me', name: currentUserName, role: 'user', accent: 'primary' }
  }
  if (view.senderRole === 'orchestrator') {
    return {
      id: 'orchestrator',
      name: 'Orchestrator',
      role: 'orchestrator',
      icon: 'hub',
      accent: 'violet'
    }
  }
  const member = view.senderAgentId ? members.get(view.senderAgentId) : undefined
  return {
    id: view.senderAgentId ?? 'agent',
    name: member?.name ?? 'Agent',
    role: 'agent',
    accent: 'green',
    color: member?.color ?? undefined,
    avatarDataUrl: member?.avatar ?? undefined
  }
}

/** Map a persisted group presentation_log message to a renderer ChatMessage card. */
export function groupMessageToDisplay(
  view: GroupMessageView,
  members: Map<string, GroupSenderMeta>,
  currentUserName: string
): ChatMessage {
  const base = { id: view.id, chatId: view.groupChatId, timestamp: view.createdAt }
  if (view.kind === 'system') {
    return { ...base, kind: 'system', text: view.text }
  }
  const sender = resolveSender(view, members, currentUserName)
  if (view.kind === 'task-list') {
    return { ...base, kind: 'task-list', sender, heading: view.heading, tasks: view.tasks }
  }
  if (view.kind === 'options') {
    return {
      ...base,
      kind: 'options',
      sender,
      text: view.text,
      options: view.options,
      answered: view.answered,
      answeredOptionId: view.answeredOptionId
    }
  }
  if (view.kind === 'agent-question') {
    return {
      ...base,
      kind: 'agent-question',
      sender,
      questions: view.questions,
      summary: view.summary,
      answered: view.answered,
      answerText: view.answerText
    }
  }
  return { ...base, kind: 'text', sender, text: view.text }
}
