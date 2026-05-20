/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_LOGI_GROUP_ID?: string;
  /** URL absoluta https/http de la plantilla Excel de operarios (p. ej. SharePoint). Requerida para «Descargar plantilla». */
  readonly VITE_PLANTILLA_OPERARIOS_URL?: string;
  /** URL absoluta https/http de la plantilla Excel de administrativos. Requerida para «Descargar plantilla». */
  readonly VITE_PLANTILLA_ADMINISTRATIVOS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

