import { INetworkAdapter } from "./INetworkAdapter";
import { WebSocketAdapter } from "./WebSocketAdapter";

const SERVER_URL = import.meta.env.SERVER || '127.0.0.1';
const WS_PORT = import.meta.env.WS_PORT || '15432';
const WS_PROTOCOL = import.meta.env.WS_PROTOCOL || 'ws';

export class NetworkFactory {
  // TODO: Add a method to create a network adapter based on the environment
}