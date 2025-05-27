
interface ImportMetaEnv {
  VITE_WS_PROTOCOL: string;
  VITE_WS_PORT: string;
  VITE_SERVER: string;
  MODE: string;
  WT_PROTOCOL: string;
  WT_PORT: string;
  readonly VITE_API_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly WS_PORT: string;
  readonly SERVER: string;
  readonly WS_PROTOCOL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
