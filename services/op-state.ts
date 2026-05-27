const OP_KEY = 'bilibili_op_state';

export interface OpState {
  active: boolean;
  phase: 'downloading' | 'polishing' | 'importing';
  kind: 'export' | 'import';
  current: number;
  total: number;
  title: string;
  timestamp: number;
}

export async function setOpState(state: OpState): Promise<void> {
  await chrome.storage.local.set({ [OP_KEY]: state });
}

export async function getOpState(): Promise<OpState | null> {
  const result = await chrome.storage.local.get(OP_KEY);
  const state = result[OP_KEY] as OpState | undefined;
  if (!state?.active) return null;
  // Expire after 10 minutes (stale cleanup)
  if (Date.now() - state.timestamp > 600_000) {
    await chrome.storage.local.remove(OP_KEY);
    return null;
  }
  return state;
}

export async function clearOpState(): Promise<void> {
  await chrome.storage.local.remove(OP_KEY);
}
