const STATUS_ERROR_TTL_MS = 30_000;
const STATUS_ERROR_REASON_MAX_LEN = 72;
const STATUS_ERROR_DEDUP_WINDOW_MS = 5_000;

type ITrayStatusError = {
  message: string;
  expiresAt: number;
  lastUpdatedAt: number;
};

let state: ITrayStatusError | null = null;

function normalizeStatusErrorMessage(message: string): string | null {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length <= STATUS_ERROR_REASON_MAX_LEN) return normalized;
  return `${normalized.slice(0, STATUS_ERROR_REASON_MAX_LEN)}...`;
}

export function setStatusErrorOverride(message: string): void {
  const reason = normalizeStatusErrorMessage(message);
  if (!reason) return;
  const now = Date.now();
  if (state) {
    const withinDedup = now - state.lastUpdatedAt <= STATUS_ERROR_DEDUP_WINDOW_MS;
    if (withinDedup && state.message === reason) return;
  }
  state = {
    message: reason,
    expiresAt: now + STATUS_ERROR_TTL_MS,
    lastUpdatedAt: now,
  };
}

export function getStatusErrorOverrideLabel(): string | null {
  if (!state) return null;
  if (Date.now() > state.expiresAt) {
    state = null;
    return null;
  }
  return `Status: error (${state.message})`;
}
