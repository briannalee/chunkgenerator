
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly WS_PORT: string;
  readonly SERVER: string;
  readonly WS_PROTOCOL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
