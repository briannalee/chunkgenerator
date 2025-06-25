export interface INetworkAdapter {
  connect(): Promise<void>;
  disconnect(): void;
  send(data: unknown): void;
  onMessage(callback: (data: unknown) => void): void;
  offMessage?(callback: (data: unknown) => void): void; // mark as optional for backward compatibility
  onDisconnect(callback: () => void): void;
  readyState: 'connecting' | 'open' | 'closing' | 'closed';
}