declare const __GIT_HASH__: string;
declare const __BUILD_TIME__: string;
declare const __VERSION__: string;

/// <reference types="vite/client" />
/// <reference types="wxt/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
