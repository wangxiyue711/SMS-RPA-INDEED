// src/lib/rpaState.ts
import type { ChildProcess } from "child_process";

export type RpaLog = { type: "stdout" | "stderr"; message: string; timestamp: string };
export type RpaProcInfo = {
  process: ChildProcess;
  startTime: string;
  endTime?: string;
  exitCode?: number | null;
  status?: "running" | "completed" | "error" | "stopped";
  mode: string;
  logs: RpaLog[];
  error?: string;
};

// 模块级单例（在 dev 下热更新也能尽量复用）
const globalAny = global as any;
if (!globalAny.__RPA_PROCESSES__) {
  globalAny.__RPA_PROCESSES__ = new Map<string, RpaProcInfo>();
}
export const rpaProcesses: Map<string, RpaProcInfo> = globalAny.__RPA_PROCESSES__;
