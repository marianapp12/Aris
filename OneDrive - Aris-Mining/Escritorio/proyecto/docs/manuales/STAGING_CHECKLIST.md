# Checklist de staging

Entorno de prueba controlado (tenant, aplicación Entra ID, cola UNC y OU de prueba) antes de producción.

## Variables y conectividad

- [ ] Misma matriz de variables que producción, con valores de **staging** (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `GROUP_*_ID`, rutas `AD_QUEUE_*`, `AD_LDAP_*`, etc.).
- [ ] Comprobar que un `503` con mensaje de configuración incompleta aparece si falta una variable crítica (comportamiento ya cubierto en tests para rutas sin cola configurada).
- [ ] El proceso Node puede leer y escribir en `AD_QUEUE_UNC` y leer resultados (`AD_QUEUE_RESULTS_UNC` o derivado de `AD_QUEUE_UNC`).

## API y cola administrativa

- [ ] `GET /api/users/administrative/queue-connection-test` (desde el front: prueba de conexión a cola) confirma acceso SMB.
- [ ] `GET /api/users/administrative/next-username` con nombres válidos devuelve propuesta coherente (LDAP / dominio según configuración).
- [ ] Alta individual administrativa: `POST /api/users` o `POST /api/users/administrative` → `202`, polling a `GET /api/users/administrative/queue-requests/{requestId}/result` hasta `success` o `error`.
- [ ] Carga masiva administrativa con Excel pequeño (plantilla real); revisar filas con error en la respuesta.

## Operativo (Microsoft 365)

- [ ] `GET /api/users/next-username` con datos válidos.
- [ ] Crear un usuario operativo de prueba y verificar en Entra ID y membresías de grupos (sede + grupos comunes).
- [ ] Carga masiva operativa con Excel pequeño.

## Limpieza y operación

- [ ] Tras flujos que generen `procesado-employeeId-*.json`, revisar logs del worker de limpieza Graph (`AD_PROCESSED_GRAPH_*`) y que no haya excepciones no controladas.
- [ ] Ejecutar en local o CI: `npm test` en la carpeta `backend`.
