import { INetworkAdapter } from "./INetworkAdapter";
import pako from 'pako';

export class WebSocketAdapter implements INetworkAdapter {
  private socket: WebSocket | null = null;
  private messageCallbacks = new Set<(data: unknown) => void>();
  private disconnectCallback: (() => void) | null = null;
  readyState: "connecting" | "open" | "closing" | "closed" = "closed";
  constructor(private url: string) { }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyState = "connecting";
      this.socket = new WebSocket(this.url);
      this.socket.binaryType = 'arraybuffer';


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
          let data;
          if (event.data instanceof ArrayBuffer) {
            const decompressed = pako.ungzip(new Uint8Array(event.data), { to: 'string' });
            data = JSON.parse(decompressed.toString());
          } else {
            data = JSON.parse(event.data);
          }

          for (const cb of this.messageCallbacks) {
            cb(data);
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
    this.messageCallbacks.add(callback);
  }

  offMessage(callback: (data: unknown) => void): void {
    this.messageCallbacks.delete(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }
}
