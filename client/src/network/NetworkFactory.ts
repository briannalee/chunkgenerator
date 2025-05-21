import { INetworkAdapter } from "./INetworkAdapter";
import { WebSocketAdapter } from "./WebSocketAdapter";

const SERVER_URL = import.meta.env.SERVER || 'localhost';
const WS_PORT = import.meta.env.WS_PORT || '8080'; // WebSocket port
const WS_PROTOCOL = import.meta.env.WS_PROTOCOL || 'ws'; // WebSocket protocol

export class NetworkFactory {
  static createAdapter(forceWebTransport: boolean = false): INetworkAdapter {
    if (forceWebTransport || (typeof WebTransport !== 'undefined' && this.supportsWebTransport())) {
      // TODO: Implement WebTransportAdapter
      throw new Error("WebTransport is not implemented yet.");
    }
    const url = `${WS_PROTOCOL}://${SERVER_URL}:${WS_PORT}`; // WebSocket URL
    return new WebSocketAdapter(url);
  }

  private static supportsWebTransport(): boolean {
    try {
      // Feature detection with user agent filtering
      return typeof WebTransport === 'function' &&
        !/Firefox|Safari|iPhone|iPad|iPod/i.test(navigator.userAgent);
    } catch {
      return false;
    }
  }
}
