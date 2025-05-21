import { INetworkAdapter } from "./INetworkAdapter";
export class WebSocketAdapter implements INetworkAdapter {
  private socket: WebSocket;
  private messageCallbacks: Array<(data: unknown) => void> = [];
  private disconnectCallbacks: Array<() => void> = [];
  
  constructor(private url: string) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data.toString());
        this.messageCallbacks.forEach(cb => cb(data));
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };
    this.socket.onclose = () => {
      this.disconnectCallbacks.forEach(cb => cb());
    };
  }

  async connect(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    
    return new Promise((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = (error) => reject(error);
    });
  }

  disconnect(): void {
    this.socket.close();
  }

  send(data: unknown): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Trying to send while connection is not open');
      return;
    }
    this.socket.send(JSON.stringify(data));
  }

  onMessage(callback: (data: unknown) => void): void {
    this.messageCallbacks.push(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  get readyState() {
    switch (this.socket.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'open';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'closed';
      default: return 'closed';
    }
  }
}
