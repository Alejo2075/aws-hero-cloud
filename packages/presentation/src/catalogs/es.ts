import type { MessageCatalog } from '../types.js';
import { esPlan } from './es-plan.js';
import { esResult } from './es-result.js';

const tri = (simple: string, guided: string, expert: string) => ({ simple, guided, expert });

export const es: MessageCatalog = {
  locale: 'es',
  messages: {
    ...esPlan,
    ...esResult,
    // ---- etiquetas de las vistas -----------------------------------------------------------
    'view.analysis.title': 'Lo que Hero entendió de {name}',
    'view.section.summary': 'Resumen',
    'view.section.components': 'De qué se compone tu aplicación',
    'view.section.questions': 'Preguntas para ti',
    'view.section.leftout': 'Omitido por tu seguridad',
    'view.section.detections': 'Lo que Hero detectó',
    'view.section.spec': 'Hero Spec',
    'view.section.skipped': 'Archivos omitidos',
    'view.section.details': 'Detalles',
    'view.analysis.nothing': tri(
      'Hero todavía no puede saber qué es esta aplicación. Necesita un poco de ayuda tuya.',
      'Hero no reconoció un sitio web, un servicio ni una base de datos en este proyecto, así que no va a inventar un plan.',
      'No se detectó ninguna capacidad de frontend, servicio, datos ni almacenamiento. No se planificará nada hasta responder las preguntas abiertas.',
    ),
    'view.analysis.summary': tri(
      'Tu aplicación, {name}, se ve así:',
      '{name} se compone de las partes de abajo. Cada una indica por qué Hero lo cree.',
      '{name}: componentes en el Hero Spec: {count}.',
    ),
    'view.questions.intro': tri(
      'Preguntas que Hero necesita que respondas antes de continuar: {count}.',
      'Estas preguntas no se pudieron resolver solo con el código. Tus respuestas deciden el plan.',
      'Preguntas abiertas: {count}. Respóndelas con `PlanOptions.answers`, indexadas por id.',
    ),
    'view.leftout.count': tri(
      'Archivos ignorados porque parecen contraseñas o claves: {count}. Hero nunca los lee.',
      'Archivos dejados fuera del análisis porque parecen secretos: {count}. Nunca se leen, se suben ni se envían a una IA.',
      'Entradas omitidas por el cargador de la fuente: {count}.',
    ),
    'view.analysis.ai': tri('', '', 'Una IA participó en este análisis.'),

    // ---- encabezados de tablas y etiquetas pequeñas ----------------------------------------
    'column.capability': 'Capacidad',
    'column.confidence': 'Confianza',
    'column.evidence': 'Evidencia',
    'column.id': 'Id',
    'column.code': 'Código',
    'column.details': 'Detalles',
    'column.options': 'Opciones',
    'column.path': 'Ruta',
    'column.reason': 'Motivo',
    'meta.source-hash': 'Hash de la fuente',
    'meta.ai-assisted': 'Con ayuda de IA',
    'meta.yes': 'sí',
    'meta.no': 'no',
    'confidence.high': 'muy seguro',
    'confidence.medium': 'bastante seguro',
    'confidence.low': 'poco seguro',
    'skipped.sensitive': 'parece un secreto',
    'skipped.symlink': 'enlace simbólico (nunca se sigue)',
    'skipped.ignored': 'dependencias o resultado de compilación',
    'skipped.special': 'no es un archivo normal',

    // ---- componentes -----------------------------------------------------------------------
    'component.frontend': tri(
      'Un sitio web',
      'Un sitio web hecho con {framework}',
      'frontend framework={framework}',
    ),
    'component.service.http': tri(
      'Un programa que responde peticiones desde internet',
      'Un servicio web ({id}) que usa {runtime}',
      'service {id}: http, runtime={runtime}',
    ),
    'component.service.scheduled': tri(
      'Un programa que se ejecuta en horarios',
      'Una tarea programada ({id}) que usa {runtime}',
      'service {id}: scheduled, runtime={runtime}',
    ),
    'component.service.worker': tri(
      'Un programa que trabaja en segundo plano',
      'Un proceso en segundo plano ({id}) que usa {runtime}',
      'service {id}: worker, runtime={runtime}',
    ),
    'component.service.process': tri(
      'Un programa que se ejecuta por su cuenta',
      'Un programa de larga duración ({id}) que usa {runtime}',
      'service {id}: process, runtime={runtime}',
    ),
    'component.data.relational': tri(
      'Una base de datos',
      'Una base de datos relacional ({engine})',
      'data {id}: relational, engine={engine}',
    ),
    'component.data.key-value': tri(
      'Un almacén de datos sencillo',
      'Un almacén de datos clave-valor',
      'data {id}: key-value',
    ),
    'component.data.document': tri(
      'Una base de datos',
      'Una base de datos de documentos ({engine})',
      'data {id}: document, engine={engine}',
    ),
    'component.data.cache': tri(
      'Una memoria rápida',
      'Una caché ({engine})',
      'data {id}: cache, engine={engine}',
    ),
    'component.data.search': tri(
      'Un motor de búsqueda',
      'Un motor de búsqueda',
      'data {id}: search',
    ),
    'component.storage.object': tri(
      'Almacenamiento para archivos',
      'Almacenamiento de objetos para archivos',
      'storage {id}: object',
    ),
    'component.storage.file-system': tri(
      'Una carpeta en disco que hay que conservar',
      'Archivos en un disco que debe sobrevivir a los reinicios',
      'storage {id}: file-system',
    ),
    'component.auth': tri(
      'Personas que inician sesión',
      'Los usuarios inician sesión',
      'auth.required=true',
    ),
    'component.environment': tri(
      'Ajustes que tendrás que proporcionar: {count}',
      'Ajustes que la aplicación lee (solo nombres): {names}',
      'environment: {names}',
    ),

    // ---- capacidades -----------------------------------------------------------------------
    'capability.web-frontend': tri('un sitio web', 'un sitio o página web', 'web-frontend'),
    'capability.http-service': tri(
      'un programa que responde peticiones',
      'un servicio HTTP',
      'http-service',
    ),
    'capability.scheduled-job': tri(
      'un programa que se ejecuta en horarios',
      'una tarea programada',
      'scheduled-job',
    ),
    'capability.process-service': tri(
      'un programa que se ejecuta por su cuenta',
      'un proceso de larga duración',
      'process-service',
    ),
    'capability.relational-data': tri(
      'una base de datos',
      'una base de datos relacional',
      'relational-data',
    ),
    'capability.key-value-data': tri(
      'un almacén de datos sencillo',
      'un almacén clave-valor',
      'key-value-data',
    ),
    'capability.document-data': tri(
      'una base de datos',
      'una base de datos de documentos',
      'document-data',
    ),
    'capability.cache': tri('una memoria rápida', 'una caché', 'cache'),
    'capability.search': tri('un motor de búsqueda', 'un motor de búsqueda', 'search'),
    'capability.object-storage': tri(
      'almacenamiento para archivos',
      'almacenamiento de objetos',
      'object-storage',
    ),
    'capability.file-uploads': tri(
      'personas que suben archivos',
      'subida de archivos',
      'file-uploads',
    ),
    'capability.file-system-write': tri(
      'guardar archivos en disco',
      'escribe en el disco local',
      'file-system-write',
    ),
    'capability.authentication': tri(
      'personas que inician sesión',
      'autenticación de usuarios',
      'authentication',
    ),
    'capability.environment-variables': tri(
      'ajustes',
      'variables de entorno',
      'environment-variables',
    ),
    'capability.node-runtime': tri('JavaScript', 'el entorno Node.js', 'node-runtime'),
    'capability.monorepo': tri(
      'varios proyectos en uno',
      'un monorepo con varios paquetes',
      'monorepo',
    ),
    'capability.declared-spec': tri(
      'un archivo de ajustes',
      'un archivo hero.yaml (no es de confianza)',
      'declared-spec',
    ),

    // ---- evidencia -------------------------------------------------------------------------
    'evidence.dependency': tri('', 'usa la biblioteca {value}', 'dependency {value}'),
    'evidence.file': tri('', 'tiene el archivo {value}', 'file {value}'),
    'evidence.script': tri('', 'tiene un script "{value}"', 'script {value}'),
    'evidence.field': tri('', 'define {value}', 'field {value}'),
    'evidence.config': tri('', 'está configurado con {value}', 'config {value}'),
    'evidence.source': tri('', 'el código muestra {value}', 'source {value}'),
    'evidence.absent': tri('', 'no hay {value}', 'absent {value}'),
    'evidence.default': tri('', 'usa por defecto {value}', 'default {value}'),
    'evidence.source.listen-port': tri('', 'el código abre un puerto de red', 'source listen-port'),
    'evidence.source.health-route': tri(
      '',
      'el código tiene una dirección de comprobación de salud',
      'source health-route',
    ),
    'evidence.config.output=export': tri(
      '',
      'está configurado para exportar un sitio estático',
      'config output=export',
    ),
    'evidence.config.server-rendering': tri(
      '',
      'genera las páginas en un servidor',
      'config server-rendering',
    ),
    'evidence.absent.package.json': tri(
      '',
      'no hay package.json, así que es HTML simple',
      'absent package.json',
    ),
    'evidence.unknown': tri('', '{value}', '{value}'),

    // ---- preguntas -------------------------------------------------------------------------
    'question.detector.failed': tri(
      'Hero no pudo revisar una parte de tu proyecto.',
      'Una de las comprobaciones de Hero ({detector}) no terminó, así que esa parte se omitió.',
      'El detector {detector} falló o superó el tiempo; faltan sus hallazgos.',
    ),
    'question.merge.conflict': tri(
      'Hero encontró dos respuestas distintas sobre lo mismo y eligió la más probable. Por favor revísala.',
      'Dos comprobaciones no coincidieron sobre {kind} "{id}". Hero conservó la más segura; confírmala.',
      'Contribución {kind} en conflicto para el id {id}; ganó la de mayor confianza.',
    ),
    'question.repository-spec.invalid': tri(
      'Tu proyecto tiene un archivo de ajustes que Hero no pudo leer. Se ignoró.',
      'El {file} de tu proyecto no es válido, así que se ignoró.',
      '{file} no pasó la validación del Hero Spec y no se aplicó.',
    ),
    'question.repository-spec.unverified': tri(
      'El archivo de ajustes de tu proyecto dice algo que Hero no pudo confirmar. Se ignoró por seguridad.',
      'El {file} de tu proyecto declara "{field}", pero Hero no pudo confirmarlo con el código, así que no se usó.',
      '{file} declara {field}; el análisis no lo confirmó. Aporta el spec desde fuera de la fuente para usarlo.',
    ),
    'question.frontend.build-missing': tri(
      'Hero no encontró cómo construir tu sitio web.',
      'El proyecto no tiene un script "build", así que Hero no sabe cómo preparar el sitio.',
      'Se detectó un frontend, pero package.json no tiene scripts.build.',
    ),
    'question.service.start-unknown': tri(
      'Hero no encontró cómo iniciar tu programa.',
      'El proyecto no tiene un script "start" ni un archivo de inicio claro para el servicio "{service}".',
      'No hay scripts.start, main ni archivo de entrada convencional para el servicio {service}.',
    ),
    'question.service.port-unknown': tri(
      'Hero no pudo saber por qué puerta escucha tu programa.',
      'Hero no encontró el puerto de red que usa el servicio "{service}".',
      'No se encontró ninguna llamada listen() ni valor por defecto de PORT para el servicio {service}.',
    ),
    'question.scheduled.inside-server': tri(
      'Tu programa hace tareas programadas y también responde peticiones. ¿Deben ejecutarse por separado?',
      'Un programador de tareas corre dentro de tu servidor web. Separarlos suele ser más seguro, pero es decisión tuya.',
      'Hay una biblioteca de cron y un framework de servidor; la tarea no puede separarse automáticamente.',
    ),
    'question.data.sqlite-persistence': tri(
      'Tu aplicación guarda sus datos en un archivo. ¿Esos datos deben sobrevivir a los reinicios?',
      'SQLite guarda los datos en un archivo en disco. Si deben sobrevivir a reinicios y actualizaciones, necesita almacenamiento duradero.',
      'Se detectó SQLite: confirma si el archivo de la base de datos necesita almacenamiento persistente.',
    ),
    'question.data.engine-unknown': tri(
      'Tu aplicación usa una base de datos, pero Hero no pudo saber de qué tipo.',
      'La biblioteca {library} funciona con varios motores de bases de datos y el proyecto no indica cuál.',
      'Se detectó el ORM {library} sin un motor reconocible.',
    ),
    'question.storage.uploads': tri(
      'Las personas pueden subir archivos. ¿Dónde deben guardarse?',
      'La aplicación acepta subidas. Elige si van a almacenamiento de objetos o se quedan en un disco.',
      'Hay una biblioteca de subida de archivos sin destino de almacenamiento detectado.',
    ),
    'question.storage.writes-to-disk': tri(
      'Tu programa guarda archivos en su propio disco. ¿Deben conservarse?',
      'El código escribe archivos localmente. Si deben sobrevivir a los reinicios, necesitan almacenamiento duradero.',
      'Se encontraron escrituras locales de archivos y no hay almacenamiento de objetos.',
    ),
    'question.monorepo.choose-package': tri(
      'Tu proyecto contiene varias aplicaciones. ¿Cuál debe poner Hero en línea?',
      'Este repositorio contiene varios paquetes. Elige el que se va a desplegar.',
      'Workspace con varios paquetes y sin raíz desplegable. Vuelve a ejecutar con `root`.',
    ),
    'question.app.not-recognized': tri(
      'Hero todavía no reconoce este tipo de aplicación, así que no va a inventar nada.',
      'Este proyecto no coincide con ningún framework que Hero conozca. Puedes describirlo tú o compartirlo para que se añada soporte.',
      'Ningún framework ni capacidad conocida coincidió. Consulta el informe de aplicación no soportada.',
    ),

    // ---- errores ---------------------------------------------------------------------------
    'error.approval.digest-mismatch': tri(
      'El plan cambió después de que lo aprobaste, así que no se hizo nada.',
      'La aprobación no coincide con este plan. Revísalo y apruébalo de nuevo.',
      'approval.planDigest difiere del digest del plan guardado.',
    ),
    'error.approval.account-mismatch': tri(
      'Esta aprobación era para otra cuenta de AWS, así que no se hizo nada.',
      'La aprobación se hizo para otra cuenta de AWS.',
      'approval.accountId difiere de plan.target.accountId.',
    ),
    'error.approval.region-mismatch': tri(
      'Esta aprobación era para otra región, así que no se hizo nada.',
      'La aprobación se hizo para otra región de AWS.',
      'approval.region difiere de plan.target.region.',
    ),
    'error.approval.expired': tri(
      'La aprobación es demasiado antigua. Apruébala de nuevo.',
      'Las aprobaciones caducan al poco tiempo. Revisa el plan y apruébalo de nuevo.',
      'Reto o aprobación posterior a expiresAt.',
    ),
    'error.approval.unknown-challenge': tri(
      'Hero no reconoce esta aprobación. Apruébala de nuevo.',
      'La aprobación ya se usó o nunca la emitió este motor.',
      'Nonce no encontrado: reto de un solo uso ya consumido o falsificado.',
    ),
    'error.approval.plan-mismatch': tri(
      'Esta aprobación es de otro plan, así que no se hizo nada.',
      'La aprobación pertenece a otro plan.',
      'approval.planId difiere de plan.id.',
    ),
    'error.plan.unknown': tri(
      'Hero no conoce este plan.',
      'Este motor no produjo este plan, así que no se puede aprobar.',
      'id de plan no encontrado en PlanStore.',
    ),
    'error.plan.tampered': tri(
      'Este plan fue modificado, así que Hero no lo usará.',
      'El plan ya no coincide con su sello. Créalo de nuevo.',
      'isSealIntact(plan) es falso o el digest difiere de la referencia.',
    ),
    'error.plan.blocking-warning': tri(
      'Hay algo que corregir antes de poner esto en línea.',
      'El plan tiene una advertencia bloqueante. Resuélvela primero.',
      'El plan contiene una advertencia con severity=blocking.',
    ),
    'error.plan.missing-input': tri(
      'Hero necesita algunos datos más para continuar.',
      'Faltan algunas entradas obligatorias.',
      'requiredInputs sin satisfacer.',
    ),
    'error.identity.root-refused': tri(
      'Iniciaste sesión en AWS como dueño de la cuenta. Por tu seguridad, Hero no lo usará.',
      'Hero rechaza las credenciales root. Inicia sesión con un usuario o rol limitado.',
      'sts:GetCallerIdentity devolvió el principal root.',
    ),
    'error.identity.unknown': tri(
      'Hero no pudo saber quién eres en AWS.',
      'No se pudieron verificar las credenciales de AWS.',
      'Falló sts:GetCallerIdentity.',
    ),
    'error.source.not-found': tri(
      'Hero no pudo encontrar o abrir eso.',
      'No se pudo encontrar o abrir la carpeta, el archivo o el repositorio.',
      'La ubicación de la fuente no existe, no se puede leer o no es del tipo esperado.',
    ),
    'error.source.too-large': tri(
      'Ese proyecto es demasiado grande para que Hero lo lea con seguridad.',
      'El proyecto supera el límite de tamaño.',
      'Un archivo, el tamaño total o la razón de compresión superó un límite.',
    ),
    'error.source.too-many-files': tri(
      'Ese proyecto tiene demasiados archivos para que Hero lo lea con seguridad.',
      'El proyecto supera el límite de cantidad de archivos.',
      'Se superó maxFiles.',
    ),
    'error.source.unsafe-path': tri(
      'Ese proyecto contiene algo inseguro, así que Hero se detuvo.',
      'Una ruta del proyecto intenta salirse de su carpeta, o un archivo cambió mientras se leía.',
      'Salto de directorio, ruta absoluta, enlace simbólico, colisión o hash distinto.',
    ),
    'error.source.unsupported': tri(
      'Hero no puede usar ese tipo de fuente.',
      'Este tipo de fuente, dirección o archivo comprimido no está soportado.',
      'Esquema, host, característica del archivo o versión de git no soportados.',
    ),
    'error.source.timeout': tri(
      'Tardó demasiado, así que Hero se detuvo.',
      'La operación superó su límite de tiempo.',
      'Tiempo agotado al cargar o analizar.',
    ),
    'error.spec.invalid': tri(
      'La descripción de la aplicación no es válida.',
      'El Hero Spec no pasó la validación.',
      'Falló la validación del Hero Spec: {issues}',
    ),
    'error.provider.unavailable': tri(
      'Hero no puede conectarse a AWS ahora mismo.',
      'No se pudo contactar al proveedor de nube.',
      'Falló la llamada al proveedor.',
    ),
    'error.deployment.failed': tri(
      'El despliegue no funcionó. No se perdió nada de tus archivos.',
      'El despliegue falló. Revisa los detalles e inténtalo de nuevo.',
      'El despliegue falló; consulta los eventos del stack.',
    ),
    'error.deployment.locked': tri(
      'Ya hay otro despliegue de esta aplicación en curso.',
      'Hay un bloqueo de despliegue activo para este proyecto.',
      'Bloqueo de despliegue retenido por otro proceso.',
    ),
    'error.internal.unexpected': tri(
      'Algo salió mal dentro de Hero.',
      'Ocurrió un error inesperado. No es culpa tuya.',
      'Error interno inesperado. Vuelve a ejecutar con HERO_DEBUG=1.',
    ),
    'error.internal.not-implemented': tri(
      'Esa parte de Hero todavía no está lista.',
      'Esta operación no está disponible en esta versión.',
      'La operación {operation} no está implementada.',
    ),
    // ---- command line ------------------------------------------------------------------------
    'cli.help': `hero-cloud: pon cualquier aplicación en tu propia cuenta de AWS

Uso:
  hero-cloud analyze <fuente> [opciones]
  hero-cloud plan <fuente> [opciones]
  hero-cloud deploy <fuente> [opciones]
  hero-cloud health <despliegue>
  hero-cloud setup [--prepare] [--write-profile <nombre>]
  hero-cloud mcp [--allow <carpeta>]...
  hero-cloud approve <solicitud>
  hero-cloud outputs <despliegue>
  hero-cloud secret <despliegue> <NOMBRE>
  hero-cloud destroy <despliegue> [opciones]

<fuente> es una carpeta, un archivo .zip o un repositorio Git https://.
Hero la lee sin ejecutar nada y te dice qué necesita.

Opciones:
  -l, --level <simple|guided|expert>  Cuánto detalle mostrar (por defecto: simple)
      --locale <etiqueta>             Idioma, como en o es
      --json                          Imprime JSON legible por máquinas
      --root <carpeta>                Analiza una carpeta dentro de la fuente (monorepos)
      --name <nombre>                 Nombre a usar si el proyecto no tiene uno
      --spec <archivo>                Usa un Hero Spec que tú aportas en vez de analizar
      --kind <directory|zip|git>      Fuerza el tipo de fuente
      --region <región>               Región de AWS para el plan (por defecto: us-east-1)
      --account-id <12 dígitos>       La cuenta de AWS para la que es el plan
      --offline                       No usa la red, ni siquiera para precios públicos
      --answer <pregunta>=<respuesta> Responde una pregunta de Hero (se puede repetir)
      --approve <digest del plan>     Aprueba exactamente este plan sin preguntar (para scripts)
      --budget-email <dirección>      Adónde se envían las alertas de gasto
      --profile <nombre>              Usa este perfil de AWS
      --prepare                       (setup) Prepara tu cuenta de AWS una vez, tras tu aprobación
      --write-profile <nombre>        (setup) Agrega un perfil que usa el rol desplegador limitado
      --allow <carpeta>               (mcp) Una carpeta que un asistente puede analizar (se puede repetir)
      --ai <anthropic|openai|openai-compatible|ollama|bedrock>  Pide ayuda a tu propio modelo de IA con lo que el análisis no puede saber
      --ai-model <nombre>             El modelo a usar (obligatorio con --ai)
      --ai-key-env <NOMBRE>           Nombre de la variable de entorno que contiene tu llave
      --ai-base-url <url>             Dirección de un servidor Ollama o compatible con OpenAI
      --ai-scope <file-names|snippets|full-files>  Qué aceptas compartir con él
      --state-dir <carpeta>           Dónde Hero recuerda los despliegues (por defecto: .hero)
      --no-color                      No usa colores
  -h, --help                          Muestra esta ayuda
  -v, --version                       Muestra la versión

Entorno: HERO_LEVEL, HERO_LOCALE, HERO_BUDGET_EMAIL, NO_COLOR y HERO_DEBUG=1 (muestra detalles técnicos de errores).

deploy muestra el plan y no crea nada hasta que lo apruebes. Un <despliegue> es el nombre
que Hero mostró, como hero-mi-app. Códigos de salida: 0 bien, 1 falló, 2 comando incorrecto,
3 plan bloqueado, 4 desplegado pero las comprobaciones no mostraron que funcione.`,
    'cli.prompt.approve': '¿Apruebas este plan y lo aplicas a tu cuenta de AWS? [s/N]',
    'cli.prompt.budget-email':
      'Correo para las alertas de gasto (se guarda solo en tu cuenta de AWS):',
    'cli.prompt.secret':
      'Valor del secreto {name} (no se muestra lo que escribes; déjalo vacío para omitirlo):',
    'cli.secret.stored':
      'Se guardó {name} en tu propia cuenta de AWS en {location}. Hero no guardó el valor.',
    'cli.prompt.write-profile': '¿Agregar este perfil a {path}? [s/N]',
    'cli.profile.written': 'Se agregó el perfil {name} a {path}. Despliega con --profile {name}.',
    'cli.profile.exists': 'Ya existe un perfil llamado {name} en {path}. No se cambió nada.',
    'cli.approve.expired': 'Esta solicitud venció. Pídele al asistente que haga una nueva.',
    'cli.approve.recorded': 'Registrado. La solicitud del asistente continuará ahora.',
    'cli.ai.consent':
      'Hero puede pedirle a {destination} que ayude a entender tu proyecto. Enviaría {what}. Todo lo que parezca un secreto se elimina antes, y el modelo solo puede completar datos, nunca comandos ni permisos. ¿Lo permites? [s/N]',
    'cli.ai.scope.file-names': 'los nombres de tus archivos',
    'cli.ai.scope.snippets':
      'los nombres de tus archivos y fragmentos cortos de los que describen tu proyecto (listas de paquetes, archivos de entrada)',
    'cli.ai.scope.full-files': 'los nombres de tus archivos y hasta 20 archivos completos',
    'cli.ai.no-consent':
      'No se consulta al modelo de IA: no aceptaste compartir nada con él. Se continúa sin él.',
    'cli.ai.consulted':
      'Se consultó a tu modelo de IA: se enviaron {files} nombres de archivo y {snippets} fragmentos, se quitaron {redactions} elementos que parecían secretos y se completaron {filled} datos.',
    'cli.ai.unavailable': 'No se pudo usar tu modelo de IA ({reason}). Se continúa sin él.',
    'cli.declined': 'No se aprobó. No se cambió nada.',
    'cli.progress.deploy': 'Preparando todo en AWS...',
    'cli.progress.verify': 'Comprobando que funciona...',
    'cli.progress.destroy': 'Quitando de AWS...',
    'cli.hint.answer':
      'Para responder una pregunta, ejecuta el comando de nuevo con --answer <pregunta>=<respuesta>. Preguntas por responder: {ids}',
    'cli.progress.plan': 'Planificando...',
    'cli.usage-hint': 'Ejecuta hero-cloud --help para ver cómo usarlo.',
    'cli.progress.load': 'Leyendo tu proyecto...',
    'cli.progress.analyze': 'Averiguando qué necesita...',
    'error.usage': tri(
      'Hero no entendió ese comando.',
      'La línea de comandos no era válida ({reason}). Ejecuta con --help.',
      'Uso inválido: {reason}',
    ),
    'error.unknown': tri(
      'Algo salió mal.',
      'Ocurrió un error inesperado.',
      'Error sin clasificar.',
    ),
  },
};
