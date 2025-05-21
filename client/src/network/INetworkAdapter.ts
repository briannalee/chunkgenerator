export interface INetworkAdapter {
  connect(): Promise<void>;
  disconnect(): void;
  send(data: unknown): void;
  onMessage(callback: (data: unknown) => void): void;
  onDisconnect(callback: () => void): void;
  readyState: 'connecting' | 'open' | 'closing' | 'closed';
}