/// <reference types="vite/client" />

interface ImportMetaEnv {
  VITE_STREAMING?: string;
}

interface ImportMeta {
  env: ImportMetaEnv;
}
