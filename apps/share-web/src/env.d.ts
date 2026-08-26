/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** api-gateway の場所。共有の解決先。 */
  readonly VITE_ASTRA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
