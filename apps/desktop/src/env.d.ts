/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** api-gateway の場所。未設定ならローカルの既定へ繋ぐ。 */
  readonly VITE_ASTRA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
