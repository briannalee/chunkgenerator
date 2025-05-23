import { INetworkAdapter } from "./INetworkAdapter";
export class WebSocketAdapter implements INetworkAdapter {
  connect(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  disconnect(): void {
    throw new Error("Method not implemented.");
  }
  send(data: unknown): void {
    throw new Error("Method not implemented.");
  }
  onMessage(callback: (data: unknown) => void): void {
    throw new Error("Method not implemented.");
  }
  onDisconnect(callback: () => void): void {
    throw new Error("Method not implemented.");
  }
  readyState: "connecting" | "open" | "closing" | "closed";
  // TODO: Implement the WebSocketAdapter class
}