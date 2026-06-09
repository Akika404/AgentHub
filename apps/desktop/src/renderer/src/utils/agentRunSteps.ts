import type { AgentRunStepView, AgentTodoItem } from '../api'
import type { AgentRunStep } from '../types/chatDisplay'

function planLabel(todos: AgentTodoItem[]): string {
  const done = todos.filter((todo) => todo.status === 'completed').length
  return `计划 · ${done}/${todos.length}`
}

export function runStepFromView(view: AgentRunStepView): AgentRunStep | null {
  const status: AgentRunStep['status'] =
    view.isError || view.toolStatus === 'failed' ? 'failed' : 'completed'
  if (view.type === 'thinking') {
    return {
      id: view.id,
      type: 'thinking',
      label: view.seq === 0 ? '思考中' : '继续思考',
      status,
      text: view.text ?? undefined
    }
  }
  if (view.type === 'progress') {
    return {
      id: view.id,
      type: 'progress',
      label: '过程输出',
      status,
      text: view.text ?? undefined
    }
  }
  if (view.type === 'tool') {
    return {
      id: view.id,
      type: 'tool',
      label: `正在调用 ${view.toolName ?? '工具'}`,
      status,
      toolName: view.toolName ?? undefined,
      toolUseId: view.toolUseId ?? undefined,
      input: view.input,
      output: view.output,
      isError: view.isError ?? undefined
    }
  }
  if (view.type === 'todo') {
    const todos = view.todos ?? []
    return {
      id: view.id,
      type: 'todo',
      label: planLabel(todos),
      status: 'completed',
      todos
    }
  }
  if (view.type === 'plan') {
    return {
      id: view.id,
      type: 'plan',
      label: '计划',
      status: 'completed',
      text: view.text ?? undefined
    }
  }
  return null
}

export function runStepsFromViews(steps: AgentRunStepView[] | undefined): AgentRunStep[] {
  return (steps ?? []).map(runStepFromView).filter((step): step is AgentRunStep => step !== null)
}
