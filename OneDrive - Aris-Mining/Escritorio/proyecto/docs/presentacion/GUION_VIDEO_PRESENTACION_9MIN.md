# Guion de presentación en video — Aris Mining

| Campo | Valor |
| --- | --- |
| Duración objetivo | ~9 minutos (~1.350 palabras a ~150 palabras/min) |
| Versión | 1.0 |
| Fecha | Mayo 2026 |
| Proyecto | Automatización de creación de usuarios en Active Directory y Microsoft 365 |

Documentación técnica relacionada: [README.md](../../README.md), [MANUAL_TECNICO_PROYECTO.md](../manuales/MANUAL_TECNICO_PROYECTO.md).

---

## Diagrama sugerido en el video (opcional)

```mermaid
flowchart TB
  ti[PersonalTI]
  web[AppWeb_React]
  api[Backend_Node]
  graph[MicrosoftGraph_M365]
  unc[ColaUNC_JSON]
  ps[ScriptPowerShell_AD]
  ad[ActiveDirectory]
  aadc[AzureADConnect]
  ti --> web
  web --> api
  api --> graph
  api --> unc
  unc --> ps
  ps --> ad
  ad --> aadc
  aadc --> graph
```

---

## Guion hablado

### 0:00 – 1:15 | Contexto y problema

*[Plano: logo Aris Mining o imagen corporativa; luego texto breve “Antes: servidor AD manual”]*

Buenos días. Mi nombre es [tu nombre] y presento el proyecto desarrollado para **Aris Mining**, empresa del sector minero con operaciones en América Latina, dedicada a la exploración, desarrollo y producción de oro.

En Aris Mining, la **creación de cuentas de usuario** es un paso clave en la vinculación de cada colaborador: por esas credenciales acceden a plataformas, información y herramientas de su trabajo.

Hoy, gran parte de ese proceso se hace **de forma manual**: el equipo de tecnología ingresa al servidor donde está **Active Directory**, diligencia los datos y, según el tipo de colaborador, también interviene en **Microsoft 365**. Cuando hay muchos ingresos, sobre todo en áreas operativas, la tarea se vuelve **repetitiva**, consume mucho tiempo y aumenta el riesgo de **errores involuntarios**.

Además, modificar el servidor de forma constante para tareas rutinarias **no es una buena práctica**: dificulta el control de cambios y eleva riesgos de seguridad. Existe un script de apoyo, pero **no hay una herramienta estructurada** que centralice el ingreso de datos, valide la información y permita cargas masivas con una plantilla única.

De ahí surge la pregunta central del proyecto: **¿cómo diseñar e implementar una solución que automatice y organice la creación de usuarios en Active Directory y Microsoft 365, mejorando la eficiencia y la seguridad, sin reemplazar la infraestructura existente?**

---

### 1:15 – 1:45 | Objetivo general

*[Texto en pantalla: Objetivo general]*

El **objetivo general** fue desarrollar una **aplicación web interna** que automatice la creación de usuarios **administrativos** y **operativos**, integrando servicios web y validaciones estructuradas, para reducir tiempos, errores y fortalecer el control de accesos.

---

### 1:45 – 3:00 | Análisis y diseño (objetivos 1 y 2)

*[Diagrama de arquitectura: navegador → API → Graph / cola UNC → AD]*

Para cumplir el **primer objetivo específico**, se analizó el proceso actual: se revisaron procedimientos, se levantaron requerimientos funcionales y no funcionales, y se definieron las especificaciones técnicas. Se identificaron dos perfiles claros: **operativos**, creados directamente en la nube con **Microsoft Graph**, y **administrativos**, creados en **Active Directory local** y sincronizados hacia Microsoft 365 mediante **Azure AD Connect**.

Con el **segundo objetivo**, se diseñó la arquitectura: un **front-end** en React con TypeScript; un **back-end** en Node.js con Express; **autenticación** con Microsoft Entra ID; y dos integraciones diferenciadas: **Graph** para operativos y una **cola de archivos JSON** en una carpeta compartida del servidor para administrativos, procesada por un **script PowerShell** con el módulo Active Directory. Así el personal de TI **deja de editar parámetros técnicos a mano en el servidor** para cada alta rutinaria.

---

### 3:00 – 5:30 | Solución desarrollada (objetivo 3)

*[Captura o demo: pantalla de login y pestañas Operativo / Administrativo]*

El **tercer objetivo** fue construir la aplicación con **flujos diferenciados**.

**Acceso:** solo ingresan usuarios autenticados en la organización y pertenecientes a un **grupo autorizado** de TI, lo que limita quién puede crear cuentas.

**Flujo operativo — Microsoft 365:** el formulario pide nombre, apellidos, puesto y departamento. El sistema **genera automáticamente** el nombre para mostrar y el correo corporativo, y **verifica en Graph** que el usuario no exista; si el correo base está ocupado, prueba variantes con segundo apellido o sufijo numérico. Al confirmar, el backend crea el usuario en Microsoft 365 con contraseña inicial y **cambio obligatorio en el primer inicio**, sin asignar licencias por defecto. También existe **carga masiva**: se descarga una plantilla Excel desde SharePoint, se completa y se sube; el sistema procesa fila por fila con las mismas validaciones.

**Flujo administrativo — Active Directory:** incluye los mismos datos de identidad, más **cédula obligatoria** y ciudad para ubicar la OU por sede. Antes de encolar, el backend consulta Graph para evitar **cédulas duplicadas** y propone un **nombre de usuario y UPN libres** con la misma lógica de variantes que en operativos. La solicitud no bloquea al técnico en el servidor: se guarda un archivo pendiente en la cola configurada; el script del servidor lo procesa, crea el usuario en AD y deja un archivo de **resultado** que la interfaz consulta para mostrar la confirmación. La sincronización con Microsoft 365 la realiza **Azure AD Connect** en segundo plano.

En ambos casos se busca **uniformidad**: mismas reglas de nombres, validación de campos y mensajes claros si algo falla.

---

### 5:30 – 6:30 | Seguridad y valor agregado

*[Iconos: candado, validación, trazabilidad]*

La solución **no sustituye** Active Directory ni Microsoft 365; los **optimiza**. Se reduce la exposición directa al servidor, se estandariza la información y se incorporan **prechequeos** antes de crear o encolar. Opcionalmente, el backend puede consultar **LDAP** sobre AD para reforzar la detección de duplicados. La documentación del proyecto incluye manuales de despliegue, checklist de staging y guía del script en el servidor.

---

### 6:30 – 7:45 | Validación e implementación (objetivos 4 y 5)

*[Texto: Pruebas funcionales / despliegue]*

El **cuarto objetivo** se atendió con **pruebas funcionales y técnicas**: casos documentados en los informes del repositorio, pruebas automatizadas en backend y frontend, y verificación de creación en M365 y de procesamiento de la cola AD, incluyendo escenarios de error como cédula duplicada o nombre de usuario no disponible.

El **quinto objetivo** contempla la **implementación productiva**: configuración de variables de entorno para Azure, la cola UNC, dominios y grupos; despliegue del API y del front compilado; tarea programada para el script de AD; y **capacitación** al personal autorizado para el uso seguro de la herramienta.

---

### 7:45 – 9:00 | Cierre

*[Resumen en tres viñetas en pantalla]*

En resumen: pasamos de un proceso **manual y disperso** a una **aplicación web centralizada**, con altas **individuales y masivas**, **validaciones automáticas** y **acceso restringido**, alineada con la infraestructura de Aris Mining.

Los resultados esperados son **menor carga operativa** para TI, **menos errores** y **mayor trazabilidad** en la creación de usuarios administrativos y operativos.

Gracias por su atención. Quedo atento a sus comentarios.

*[Pantalla final: contacto o créditos del proyecto]*

---

## Correspondencia objetivos ↔ minutos del video

| Objetivo | Minutos aprox. |
| --- | --- |
| Análisis y requerimientos | 1:45 – 2:30 |
| Diseño de arquitectura | 2:30 – 3:00 |
| Desarrollo y flujos | 3:00 – 5:30 |
| Validación (pruebas) | 6:30 – 7:15 |
| Implementación y capacitación | 7:15 – 7:45 |
| Problema + objetivo general + cierre | resto |

---

## Notas para grabar

- Personalizar `[tu nombre]`, sedes o ejemplos reales si el video es institucional.
- Mostrar 30–60 s de **demo en vivo** dentro del bloque 3:00–5:30 (login → alta operativa → pestaña administrativa → resultado encolado).
- Si el tiempo se excede, acortar el bloque 1:45–3:00; si sobra, ampliar la demo.
