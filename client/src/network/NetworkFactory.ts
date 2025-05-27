// chunkgenerator/client/src/network/NetworkFactory.ts
import { INetworkAdapter } from "./INetworkAdapter";
import { WebSocketAdapter } from "./WebSocketAdapter";

const SERVER_URL = import.meta.env.VITE_SERVER || '127.0.0.1';
const WS_PORT = import.meta.env.VITE_WS_PORT || '15432';
const WS_PROTOCOL = import.meta.env.VITE_WS_PROTOCOL || 'ws';

export class NetworkFactory {
  static createAdapter(): INetworkAdapter {
    const SOCKET_URL = `${WS_PROTOCOL}://${SERVER_URL}:${WS_PORT}`;
    return new WebSocketAdapter(SOCKET_URL);
  }
}