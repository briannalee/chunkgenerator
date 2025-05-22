import { INetworkAdapter } from "./INetworkAdapter";
import { WebSocketAdapter } from "./WebSocketAdapter";

const SERVER_URL = import.meta.env.SERVER || '127.0.0.1';
const WS_PORT = import.meta.env.WS_PORT || '8080';
const WS_PROTOCOL = import.meta.env.WS_PROTOCOL || 'ws';
const WT_PORT = import.meta.env.WT_PORT || '4433'; 
const WT_PROTOCOL = import.meta.env.WT_PROTOCOL || 'https';

export class NetworkFactory {
  static createAdapter(): INetworkAdapter {
    const url = `${WS_PROTOCOL}://${SERVER_URL}:${WS_PORT}`;
    return new WebSocketAdapter(url);
  }
}