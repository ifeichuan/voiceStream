export interface AgentTerminalBridge {
  getSelectedTaskId: () => string;
  isReady: () => boolean;
  isAtBottom: () => boolean;
  write: (chunk: Uint8Array) => void;
  pushPending: (chunk: Uint8Array) => void;
  finishLoading: () => void;
  scrollToBottom: () => void;
}

let bridge: AgentTerminalBridge | null = null;

export function setAgentTerminalBridge(nextBridge: AgentTerminalBridge | null) {
  bridge = nextBridge;
}

export function getAgentTerminalBridge() {
  return bridge;
}
