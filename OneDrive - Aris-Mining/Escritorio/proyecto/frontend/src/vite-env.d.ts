/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_LOGI_GROUP_ID?: string;
  /** Sufijo UPN para vista previa de cuentas AD (debe coincidir con AD_UPN_SUFFIX del backend). */
  readonly VITE_AD_UPN_SUFFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

