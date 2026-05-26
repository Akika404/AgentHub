import type {
  AgentHubApi,
  ChatDetail,
  ChatMessage,
  ChatSummary,
  NetworkNode,
  TextMessage
} from '@agenthub/shared'

const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

const chats: ChatSummary[] = [
  {
    id: 'project-collab',
    title: '项目协作群',
    preview: 'Orchestrator: 正在分配任务...',
    kind: 'group',
    avatar: { kind: 'initials', text: 'AG', tone: 'primary' },
    active: true
  },
  {
    id: 'data-analysis',
    title: '数据分析 Agent',
    preview: '分析报告已生成',
    kind: 'agent',
    avatar: { kind: 'icon', icon: 'smart_toy', tone: 'neutral' }
  },
  {
    id: 'zhangsan',
    title: '张三',
    preview: '好的，收到。',
    kind: 'user',
    avatar: { kind: 'icon', icon: 'person', tone: 'neutral' }
  },
  {
    id: 'product-discussion',
    title: '产品讨论组',
    preview: '会议纪要...',
    kind: 'team',
    avatar: { kind: 'icon', icon: 'group', tone: 'neutral' }
  }
]

const detailMap: Record<string, ChatDetail> = {
  'project-collab': {
    id: 'project-collab',
    title: '项目协作群',
    status: 'Activate',
    agentCount: 3
  },
  'data-analysis': {
    id: 'data-analysis',
    title: '数据分析 Agent',
    status: 'Activate',
    agentCount: 1
  },
  zhangsan: {
    id: 'zhangsan',
    title: '张三',
    status: 'Online',
    agentCount: 0
  },
  'product-discussion': {
    id: 'product-discussion',
    title: '产品讨论组',
    status: 'Activate',
    agentCount: 2
  }
}

const messageMap: Record<string, ChatMessage[]> = {
  'project-collab': [
    {
      id: 'm-sys-1',
      chatId: 'project-collab',
      kind: 'system',
      timestamp: '2026-05-26T10:20:00',
      text: 'xxxx0、xxxx1已加入群聊'
    },
    {
      id: 'm-user-1',
      chatId: 'project-collab',
      kind: 'text',
      timestamp: '2026-05-26T10:24:00',
      sender: {
        id: 'me',
        name: '我',
        role: 'user',
        initials: 'ME',
        accent: 'primary'
      },
      text: '请开始设计首页界面，并准备前端所需的资源。'
    },
    {
      id: 'm-orchestrator-1',
      chatId: 'project-collab',
      kind: 'text',
      timestamp: '2026-05-26T10:24:30',
      sender: {
        id: 'orchestrator',
        name: 'Orchestrator',
        role: 'orchestrator',
        icon: 'hub',
        accent: 'violet'
      },
      text: '收到任务。已拆解并分配给相关 Agent。'
    },
    {
      id: 'm-design-1',
      chatId: 'project-collab',
      kind: 'task-list',
      timestamp: '2026-05-26T10:25:00',
      sender: {
        id: 'designer',
        name: '设计师 Agent',
        role: 'agent',
        icon: 'smart_toy',
        accent: 'green'
      },
      heading: '当前任务进度：',
      tasks: [
        { id: 't-1', title: '分析需求文档', status: 'in-progress' },
        { id: 't-2', title: '生成线框图草案', status: 'pending' },
        { id: 't-3', title: '确认视觉风格', status: 'pending' },
        { id: 't-4', title: '输出高保真设计稿', status: 'pending' }
      ]
    },
    {
      id: 'm-frontend-1',
      chatId: 'project-collab',
      kind: 'options',
      timestamp: '2026-05-26T12:03:00',
      sender: {
        id: 'frontend',
        name: '前端工程师',
        role: 'agent',
        icon: 'code',
        accent: 'neutral'
      },
      text: '正在评审线框图。大部分方案可行，但发现以下几个领域需要进一步澄清或外部数据支持：',
      options: [
        { id: 'o-1', label: '使用 Vue 技术框架实现', selected: true },
        { id: 'o-2', label: '使用 React 框架实现', selected: true }
      ],
      placeholder: '在此输入您的意见或需求...'
    }
  ],
  'data-analysis': [
    {
      id: 'm-da-1',
      chatId: 'data-analysis',
      kind: 'text',
      timestamp: '2026-05-26T09:10:00',
      sender: {
        id: 'da',
        name: '数据分析 Agent',
        role: 'agent',
        icon: 'smart_toy',
        accent: 'green'
      },
      text: '本周销售数据分析报告已生成，请查阅附件。'
    }
  ],
  zhangsan: [
    {
      id: 'm-zs-1',
      chatId: 'zhangsan',
      kind: 'text',
      timestamp: '2026-05-26T08:30:00',
      sender: {
        id: 'zhangsan',
        name: '张三',
        role: 'user',
        initials: 'ZS',
        accent: 'neutral'
      },
      text: '好的，收到。'
    }
  ],
  'product-discussion': [
    {
      id: 'm-pd-1',
      chatId: 'product-discussion',
      kind: 'system',
      timestamp: '2026-05-26T14:00:00',
      text: '会议已开始'
    },
    {
      id: 'm-pd-2',
      chatId: 'product-discussion',
      kind: 'text',
      timestamp: '2026-05-26T14:01:00',
      sender: {
        id: 'pm',
        name: '产品经理',
        role: 'user',
        initials: 'PM',
        accent: 'primary'
      },
      text: '会议纪要稍后整理后同步到群里。'
    }
  ]
}

const networkMap: Record<string, NetworkNode[]> = {
  'project-collab': [
    { id: 'orchestrator', name: 'Orchestrator', status: 'active', parentId: null },
    { id: 'designer', name: '设计师 Agent', status: 'working', parentId: 'orchestrator' },
    { id: 'designer-search', name: '素材检索 Agent', status: 'idle', parentId: 'designer' },
    { id: 'frontend', name: '前端工程师 Agent', status: 'active', parentId: 'orchestrator' },
    { id: 'frontend-search', name: 'Search Agent', status: 'active', parentId: 'frontend' },
    { id: 'frontend-lint', name: '代码审查 Agent', status: 'idle', parentId: 'frontend' },
    { id: 'backend', name: '后端工程师 Agent', status: 'working', parentId: 'orchestrator' },
    { id: 'qa', name: 'QA Agent', status: 'idle', parentId: 'orchestrator' }
  ],
  'data-analysis': [
    { id: 'da', name: '数据分析 Agent', status: 'active', parentId: null },
    { id: 'da-sql', name: 'SQL 查询 Agent', status: 'working', parentId: 'da' },
    { id: 'da-viz', name: '可视化 Agent', status: 'idle', parentId: 'da' }
  ],
  zhangsan: [{ id: 'zhangsan', name: '张三', status: 'active', parentId: null }],
  'product-discussion': [
    { id: 'pm', name: '产品经理', status: 'active', parentId: null },
    { id: 'design', name: '设计师', status: 'idle', parentId: 'pm' },
    { id: 'design-research', name: '用户研究 Agent', status: 'idle', parentId: 'design' },
    { id: 'engineering', name: '工程师代表', status: 'working', parentId: 'pm' }
  ]
}

export const mockApi: AgentHubApi = {
  listChats() {
    return delay(chats.map((c) => ({ ...c })))
  },

  async getChatDetail(chatId) {
    const detail = detailMap[chatId]
    if (!detail) throw new Error(`Unknown chat: ${chatId}`)
    return delay({ ...detail })
  },

  listMessages(chatId) {
    return delay((messageMap[chatId] ?? []).map((m) => ({ ...m })))
  },

  getNetwork(chatId) {
    return delay((networkMap[chatId] ?? []).map((n) => ({ ...n })))
  },

  async sendMessage(chatId, text, replyTo) {
    const message: TextMessage = {
      id: `m-local-${Date.now()}`,
      chatId,
      kind: 'text',
      timestamp: new Date().toISOString(),
      sender: {
        id: 'me',
        name: '我',
        role: 'user',
        initials: 'ME',
        accent: 'primary'
      },
      text,
      ...(replyTo ? { replyTo } : {})
    }
    const list = messageMap[chatId] ?? (messageMap[chatId] = [])
    list.push(message)
    return delay(message, 60)
  }
}
