import type { RuntimeStatus } from '../shared/protocol.ts'
import type { RuntimeAdapter, RuntimeFactory } from './adapter.ts'
import type { PromptBlock, RuntimeCallbacks } from './runtime.ts'

interface MockState {
  seq: number
  timers: NodeJS.Timeout[]
  running: boolean
}

const SAMPLE_REPLY = [
  '## 工作区检查完成',
  '',
  '我检查了当前的 DSH 会话和文件状态。下面是建议的下一步：',
  '',
  '- **先跑一遍测试**，确认当前基线是绿的',
  '- 把 src/plugin/bridge.ts 的配对接口补上速率限制',
  '- 给设置页加一个「重新配对」入口',
  '',
  '如果你愿意，我可以直接开始修改并跑验证。',
].join('\n')

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function textOf(blocks: PromptBlock[]): string {
  return blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

/** Deterministic runtime used by the dev server, screenshots and tests. */
export class MockRuntime implements RuntimeAdapter {
  readonly #callbacks: RuntimeCallbacks
  readonly #states = new Map<string, MockState>()
  #status: RuntimeStatus = { state: 'stopped' }
  #stopped = false

  constructor(callbacks: RuntimeCallbacks) {
    this.#callbacks = callbacks
  }

  get status(): RuntimeStatus {
    return { ...this.#status }
  }

  async start(): Promise<void> {
    if (this.#status.state === 'ready') return
    this.#status = { state: 'starting' }
    this.#callbacks.onStatus({ ...this.#status })
    await delay(120)
    this.#status = { state: 'ready' }
    this.#callbacks.onStatus({ ...this.#status })
  }

  async prompt(sessionId: string, blocks: PromptBlock[], _resume: boolean): Promise<string> {
    await this.start()
    const state = this.#state(sessionId)
    const text = textOf(blocks)
    const userMessageId = 'mock-user-' + Math.random().toString(36).slice(2, 10)
    const assistantMessageId = 'mock-assistant-' + Math.random().toString(36).slice(2, 10)
    state.running = true
    this.#callbacks.onSessionStatus(sessionId, 'running')
    this.#event(sessionId, 'user/message', {
      id: userMessageId,
      role: 'user',
      source: { kind: 'user' },
      content: blocks.map((block) => block.type === 'text'
        ? { type: 'text', text: block.text }
        : { type: 'image', attachment: { mimeType: block.mimeType } }),
    })
    if (state.seq <= 4) {
      this.#event(sessionId, 'session/title', {
        title: text.replace(/\s+/gu, ' ').slice(0, 26) || '新的对话',
        source: { kind: 'fallback' },
      })
    }
    this.#event(sessionId, 'turn/start', { turn: 1 })
    this.#event(sessionId, 'step/start', { turn: 1, step: 1 })
    if (/(命令|运行|测试|test|run|pwsh)/iu.test(text)) {
      state.timers.push(setTimeout(() => {
        if (this.#stopped) return
        const callId = 'mock-call-' + Math.random().toString(36).slice(2, 9)
        this.#event(sessionId, 'tool/call', {
          turn: 1, step: 1, callId, name: 'pwsh',
          arguments: JSON.stringify({ command: 'pnpm test --run', description: 'Run the test suite' }),
        })
        state.timers.push(setTimeout(() => {
          if (this.#stopped) return
          this.#event(sessionId, 'tool/result', {
            turn: 1, step: 1,
            toolCallId: callId,
            message: {
              role: 'tool', toolCallId: callId, isError: false,
              content: [{ type: 'text', text: '✓ 46 tests passed in 3.42s\n\nTest Files  6 passed (6)\n     Tests  46 passed (46)' }],
            },
            meta: { cwd: 'D:/dev/workspace_dsh/dsh-mobile' },
          })
          this.#finish(sessionId, assistantMessageId, text)
        }, 1300))
      }, 900))
    } else {
      state.timers.push(setTimeout(() => {
        if (this.#stopped) return
        this.#finish(sessionId, assistantMessageId, text)
      }, 1400))
    }
    return userMessageId
  }

  #finish(sessionId: string, assistantMessageId: string, prompt: string): void {
    const state = this.#state(sessionId)
    this.#event(sessionId, 'assistant/message', {
      turn: 1, step: 2,
      message: {
        id: assistantMessageId,
        role: 'assistant',
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
        content: [
          { type: 'reasoning', text: '先确认项目状态，再给出可执行的下一步。' },
          { type: 'text', text: prompt.includes('总结') ? '这是一个演示回复。接上真实 DSH 后，这里会显示你的本机 agent 输出。' : SAMPLE_REPLY },
        ],
      },
      usage: { inputTokens: 1280, outputTokens: 236, totalTokens: 1516 },
    })
    this.#event(sessionId, 'step/end', { turn: 1, step: 2 })
    this.#event(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    state.running = false
    this.#callbacks.onSessionStatus(sessionId, 'idle')
  }

  async setWorkingDirectory(_sessionId: string, path: string): Promise<string> {
    await this.start()
    return path
  }

  async restart(): Promise<void> {
    for (const state of this.#states.values()) {
      for (const timer of state.timers) clearTimeout(timer)
      state.timers = []
      state.running = false
    }
    this.#status = { state: 'starting' }
    this.#callbacks.onStatus({ ...this.#status })
    await delay(250)
    this.#status = { state: 'ready' }
    this.#callbacks.onStatus({ ...this.#status })
  }

  async stop(): Promise<void> {
    this.#stopped = true
    for (const state of this.#states.values()) {
      for (const timer of state.timers) clearTimeout(timer)
      state.timers = []
    }
    this.#status = { state: 'stopped' }
    this.#callbacks.onStatus({ ...this.#status })
  }

  #state(sessionId: string): MockState {
    let state = this.#states.get(sessionId)
    if (state === undefined) {
      state = { seq: 0, timers: [], running: false }
      this.#states.set(sessionId, state)
    }
    return state
  }

  #event(sessionId: string, type: string, data: unknown): void {
    const state = this.#state(sessionId)
    state.seq += 1
    this.#callbacks.onSessionEvent(sessionId, { type, seq: state.seq, time: Date.now(), data })
  }
}

export const mockRuntimeFactory: RuntimeFactory = (callbacks) => new MockRuntime(callbacks)
