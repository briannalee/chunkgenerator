import { INetworkAdapter } from "./INetworkAdapter";

export class WebSocketAdapter implements INetworkAdapter {
  private socket: WebSocket | null = null;
  private messageCallback: ((data: unknown) => void) | null = null;
  private disconnectCallback: (() => void) | null = null;
  readyState: "connecting" | "open" | "closing" | "closed" = "closed";

  constructor(private url: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyState = "connecting";
      this.socket = new WebSocket(this.url);
      
      this.socket.onopen = () => {
        this.readyState = "open";
        resolve();
      };
      
      this.socket.onerror = (error) => {
        this.readyState = "closed";
        reject(error);
      };
      
      this.socket.onclose = () => {
        this.readyState = "closed";
        if (this.disconnectCallback) {
          this.disconnectCallback();
        }
      };
      
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.messageCallback) {
            this.messageCallback(data);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.readyState = "closing";
      this.socket.close();
      this.socket = null;
    }
  }

  send(data: unknown): void {
    if (this.socket && this.readyState === "open") {
      this.socket.send(JSON.stringify(data));
    }
  }

  onMessage(callback: (data: unknown) => void): void {
    this.messageCallback = callback;
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }
}