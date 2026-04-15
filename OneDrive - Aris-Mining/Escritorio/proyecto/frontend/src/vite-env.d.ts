/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_LOGI_GROUP_ID?: string;
  /** URL absoluta https de plantilla operativos (SharePoint, etc.); vacío = `public/plantilla-operarios.xlsx`. */
  readonly VITE_PLANTILLA_OPERARIOS_URL?: string;
  /** URL absoluta https de plantilla administrativos; vacío = `public/plantilla-administrativos.xlsx`. */
  readonly VITE_PLANTILLA_ADMINISTRATIVOS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

