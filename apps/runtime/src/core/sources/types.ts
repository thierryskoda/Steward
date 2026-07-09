export interface CheckpointStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
