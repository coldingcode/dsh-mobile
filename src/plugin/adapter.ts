import type { RuntimeStatus } from '../shared/protocol.ts'
import type { PromptBlock, RuntimeCallbacks } from './runtime.ts'

/** Minimal runtime surface the bridge needs; SdkRuntime and the mock implement it. */
export interface RuntimeAdapter {
  readonly status: RuntimeStatus
  start(): Promise<void>
  prompt(sessionId: string, blocks: PromptBlock[], resume: boolean): Promise<string>
  setWorkingDirectory(sessionId: string, path: string): Promise<string>
  restart(): Promise<void>
  stop(): Promise<void>
}

export type RuntimeFactory = (callbacks: RuntimeCallbacks) => RuntimeAdapter
