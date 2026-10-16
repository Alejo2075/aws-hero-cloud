import type { Message } from '../types.js';

const tri = (simple: string, guided: string, expert: string): Message => ({
  simple,
  guided,
  expert,
});

/** Todo lo que se dice de un plan, en español. Se une al catálogo español. */
export const esPlan: Readonly<Record<string, Message>> = {
  // ---- etiquetas de la vista -------------------------------------------------------------
  'view.plan.title': 'Tu plan para {name}',
  'view.plan.summary': tri(
    'Hero puede poner {name} en línea en tu propia cuenta de AWS. Todavía no se ha creado nada.',
    'Hero planeó {name} para tu cuenta de AWS con el enfoque "{strategy}". Todavía no se ha creado nada.',
    '{name}: strategy={strategy}, account={account}, region={region}.',
  ),
  'view.plan.nothing-created': tri(
    'No se crea nada hasta que leas este plan y lo apruebes.',
    'No se crea nada hasta que apruebes exactamente este plan. Cualquier cambio necesita una nueva aprobación.',
    'Ningún recurso se crea sin una aprobación ligada a este digest, cuenta y región.',
  ),
  'view.section.plan-summary': 'Resumen',
  'view.section.plan-blocking': 'Antes de poder ponerlo en línea',
  'view.section.plan-creates': 'Qué se va a crear',
  'view.section.plan-safeguards': 'Seguro por defecto',
  'view.section.plan-cost': 'Cuánto debería costar',
  'view.section.plan-warnings': 'Conviene saber',
  'view.section.plan-inputs': 'Lo que tienes que proporcionar',
  'view.section.plan-changes': 'Cambios',
  'view.section.plan-rationale': 'Por qué cada cambio',
  'view.section.plan-details': 'Ajustes de los recursos',
  'view.section.plan-seal': 'Sello',
  'view.plan.ready': tri(
    'Este plan está listo para aprobarse.',
    'No se encontraron problemas bloqueantes. Puedes aprobar este plan.',
    'Sin advertencias bloqueantes. El plan puede aprobarse.',
  ),
  'view.plan.strategy-reason': 'Por qué este enfoque',
  'view.plan.inputs.count': tri(
    'Ajustes que tendrás que proporcionar: {count}.',
    'La aplicación lee {count} ajuste(s). Sus nombres están abajo; los valores nunca salen de tu equipo.',
    'requiredInputs: {count}.',
  ),
  'view.plan.inputs.secrets': tri(
    'Secretos entre ellos: {count}. Hero los guarda cifrados en tu propia cuenta de AWS.',
    'Secretos entre ellos: {count}. Se guardarán cifrados (SSM Parameter Store, SecureString).',
    'Entradas secretas: {count}. Los valores se escriben directo en SSM; nunca en planes, logs ni estado.',
  ),
  'view.plan.cost.free': tri(
    'Debería costar casi nada: menos de {high} al mes.',
    'Costo esperado: menos de {high} al mes para una aplicación pequeña, de muy tranquila a ocupada.',
    'mensual {low} a {high} (confianza {confidence})',
  ),
  'view.plan.cost.range': tri(
    'Debería costar entre {low} y {high} al mes.',
    'Costo esperado: entre {low} y {high} al mes, de casi sin uso a ocupada.',
    'mensual {low} a {high} (confianza {confidence})',
  ),
  'view.plan.cost.confidence': tri(
    '',
    'Qué tan seguro: {confidence}. Los precios son {source}.',
    'confidence={confidence}, prices={source} a {asOf}',
  ),
  'view.plan.cost.note': tri(
    'Es una estimación, no una promesa. El costo real depende de cuánta gente la use.',
    'Es una estimación. El costo real depende del tráfico, que nadie puede conocer de antemano.',
    'Solo estimación. El uso se supone; ver supuestos.',
  ),
  'view.plan.cost.source.live': 'los precios publicados hoy por AWS',
  'view.plan.cost.source.cache': 'precios recientes publicados por AWS',
  'view.plan.cost.source.built-in': 'precios incluidos en Hero (no comprobados hoy)',
  'cost.confidence.low': 'baja',
  'cost.confidence.medium': 'media',
  'cost.confidence.high': 'alta',
  'cost.reason.offline': 'elegiste no usar la red',
  'cost.reason.prices-unavailable': 'no se pudo llegar a los precios de AWS',
  'column.action': 'Acción',
  'column.type': 'Tipo',
  'column.name': 'Nombre',
  'column.destructive': 'Destructivo',
  'column.severity': 'Gravedad',
  'column.kind': 'Clase',
  'column.low': 'Mín.',
  'column.high': 'Máx.',
  'column.item': 'Concepto',
  'meta.digest': 'Digest del plan',
  'meta.artifact': 'Hash del artefacto',
  'meta.source': 'Hash de la fuente',
  'meta.account': 'Cuenta',
  'meta.region': 'Región',
  'meta.strategy': 'Estrategia',
  'severity.blocking': 'bloqueante',
  'severity.warning': 'aviso',
  'severity.info': 'info',
  'action.create': 'crear',
  'action.update': 'actualizar',
  'action.replace': 'reemplazar',
  'action.delete': 'eliminar',
  'input.kind.secret': 'secreto',
  'input.kind.config': 'ajuste',

  // ---- estrategias -----------------------------------------------------------------------
  'strategy.name.static': tri('un sitio web sencillo', 'alojamiento estático', 'static'),
  'strategy.name.serverless': tri('alojamiento de pago por uso', 'serverless', 'serverless'),
  'strategy.name.container': tri(
    'un programa que corre todo el tiempo',
    'contenedores',
    'container',
  ),
  'strategy.name.virtual-machine': tri(
    'un equipo completo para él solo',
    'una máquina virtual',
    'virtual-machine',
  ),

  // ---- advertencias ----------------------------------------------------------------------
  'warning.plan.account-unverified': tri(
    'Hero todavía no sabe para qué cuenta de AWS es esto, así que es solo una vista previa.',
    'No se verificó ninguna cuenta de AWS, así que este plan es una vista previa y no puede aprobarse.',
    'accountId sin verificar (000000000000): el plan no puede aprobarse ni desplegarse.',
  ),
  'warning.plan.open-question': tri(
    'Hero necesita primero una respuesta tuya.',
    'Sigue abierta una pregunta sobre tu proyecto: {kind}.',
    'Pregunta abierta sin resolver {question} ({kind}).',
  ),
  'warning.plan.unsupported-capability': tri(
    'Esta aplicación necesita {capabilityName}, algo que Hero todavía no puede poner en línea.',
    'Esta aplicación necesita {capabilityName}. Eso requiere {strategyName}, que esta versión de Hero aún no soporta.',
    'la capacidad {capability} requiere la estrategia {needs}: no implementada.',
  ),
  'warning.plan.public-exposure': tri(
    'Una vez en línea, cualquiera en internet podrá abrirlo.',
    'El resultado será accesible para cualquiera en internet, salvo que añadas inicio de sesión.',
    'Endpoints públicos: {kinds}.',
  ),
  'warning.plan.cost-low-confidence': tri(
    'El precio es una estimación más aproximada de lo habitual.',
    'Hero no pudo usar los precios de hoy de AWS ({reasonText}), así que el costo es más aproximado de lo habitual.',
    'Precios integrados (reason={reason}, region={region}).',
  ),
  'warning.plan.ssr-cold-start': tri(
    'La primera visita tras un rato sin uso puede ser más lenta.',
    'Las páginas las genera una función que duerme cuando no se usa, así que la primera visita tras un rato puede tardar unos segundos.',
    'Renderizado en servidor sobre Lambda: habrá arranques en frío.',
  ),
  'warning.plan.scheduled-inside-server': tri(
    'Tu trabajo programado y tu sitio comparten un mismo programa.',
    'Un programador de tareas corre dentro de un servidor web. Hero no los separará por su cuenta.',
    'El programador y el servidor comparten proceso.',
  ),
  'warning.plan.secrets-required': tri(
    'Tendrás que proporcionar {count} secreto(s) antes de ponerlo en línea.',
    'Hay que proporcionar {count} secreto(s) al desplegar. Se guardan cifrados en tu cuenta.',
    'Entradas secretas requeridas: {count}.',
  ),
  'warning.plan.nothing-to-deploy': tri(
    'Hero no encontró nada que poner en línea en este proyecto.',
    'El análisis no encontró ningún sitio, servicio, dato ni almacenamiento que desplegar.',
    'No hay componente desplegable en el Hero Spec efectivo.',
  ),

  // ---- recursos --------------------------------------------------------------------------
  'resource.s3-bucket': tri(
    'Una carpeta privada para archivos',
    'Bucket de S3 (almacenamiento privado)',
    'aws:s3:Bucket',
  ),
  'resource.cloudfront-distribution': tri(
    'Una dirección web rápida y segura para tu sitio',
    'Distribución de CloudFront (entrega global)',
    'aws:cloudfront:Distribution',
  ),
  'resource.apigatewayv2-api': tri(
    'La dirección pública de tu programa',
    'API HTTP de API Gateway (punto de acceso público)',
    'aws:apigatewayv2:Api',
  ),
  'resource.lambda-function': tri(
    'Tu programa, que solo corre cuando hace falta',
    'Función Lambda (ejecuta tu código bajo demanda)',
    'aws:lambda:Function',
  ),
  'resource.iam-role': tri(
    'Permisos limitados para tu programa',
    'Rol de IAM (mínimo privilegio)',
    'aws:iam:Role',
  ),
  'resource.logs-log-group': tri(
    'Un diario de lo ocurrido, guardado 30 días',
    'Grupo de logs de CloudWatch (30 días)',
    'aws:logs:LogGroup',
  ),
  'resource.scheduler-schedule': tri(
    'El horario que arranca tu programa',
    'Programación de EventBridge Scheduler',
    'aws:scheduler:Schedule',
  ),
  'resource.dynamodb-table': tri(
    'Un lugar para guardar tus datos, con copias de seguridad',
    'Tabla de DynamoDB (bajo demanda, con respaldos a un punto en el tiempo)',
    'aws:dynamodb:Table',
  ),
  'resource.cognito-user-pool': tri(
    'Inicio de sesión para tus usuarios',
    'Grupo de usuarios de Cognito (inicio de sesión)',
    'aws:cognito:UserPool',
  ),
  'resource.cognito-user-pool-client': tri(
    'El vínculo entre tu app y el inicio de sesión',
    'Cliente de aplicación de Cognito',
    'aws:cognito:UserPoolClient',
  ),
  'resource.budgets-budget': tri(
    'Una alerta si el gasto crece',
    'Presupuesto de AWS (alerta por correo)',
    'aws:budgets:Budget',
  ),
  'resource.ssm-parameter': tri(
    'Un lugar seguro para un ajuste',
    'Parámetro de SSM (cifrado si es secreto)',
    'aws:ssm:Parameter',
  ),

  'resource.s3-bucket-policy': tri(
    'Reglas que mantienen la carpeta privada',
    'Política del bucket de S3 (solo conexiones seguras)',
    'aws:s3:BucketPolicy',
  ),
  'resource.cloudfront-access-control': tri(
    'Una llave para que solo tu dirección web pueda abrir los archivos',
    'Control de acceso al origen de CloudFront',
    'aws:cloudfront:OriginAccessControl',
  ),
  'resource.apigatewayv2-stage': tri(
    'La versión en vivo de la dirección pública',
    'Etapa de API Gateway (registros de acceso y límites de peticiones)',
    'aws:apigatewayv2:Stage',
  ),
  'resource.apigatewayv2-integration': tri(
    'El enlace entre la dirección y tu programa',
    'Integración de API Gateway',
    'aws:apigatewayv2:Integration',
  ),
  'resource.apigatewayv2-route': tri(
    'El camino que envía a los visitantes a tu programa',
    'Ruta de API Gateway',
    'aws:apigatewayv2:Route',
  ),
  'resource.lambda-permission': tri(
    'Permiso para que la dirección arranque tu programa',
    'Permiso de invocación de Lambda',
    'aws:lambda:Permission',
  ),
  'resource.iam-policy': tri(
    'La lista de lo que tu programa puede hacer',
    'Política de IAM (mínimo privilegio)',
    'aws:iam:Policy',
  ),
  'resource.cloudformation-stack': tri(
    'Un registro de lo que Hero preparó',
    'Stack de CloudFormation',
    'aws:cloudformation:Stack',
  ),
  'resource.other-resource': tri('Una pieza de apoyo', 'Recurso de apoyo', 'aws:other'),
  'warning.plan.unsupported-schedule': tri(
    'Hero no pudo fijar ese horario con exactitud, así que no programó {job}.',
    'El horario de "{job}" no se puede expresar con exactitud en AWS (por ejemplo, mezcla un día del mes con un día de la semana), así que no se creó ninguna programación.',
    'El horario de {job} no tiene equivalente exacto en EventBridge; no se planificó ningún recurso de programación.',
  ),

  // ---- líneas de costo -------------------------------------------------------------------
  'cost.line.static-storage': tri(
    'Guardar tu sitio web',
    'Almacenamiento del sitio (S3)',
    'S3 storage',
  ),
  'cost.line.static-origin-requests': tri(
    'Servir tu sitio web',
    'Peticiones de la red de entrega al almacenamiento (S3)',
    'S3 GET requests',
  ),
  'cost.line.cdn-delivery': tri(
    'Entregar tu sitio a los visitantes',
    'Entrega a los visitantes (CloudFront)',
    'CloudFront data transfer and requests',
  ),
  'cost.line.api-requests': tri(
    'Responder peticiones',
    'Peticiones a la API (API Gateway)',
    'API Gateway HTTP API requests',
  ),
  'cost.line.function-compute': tri(
    'Ejecutar tu programa',
    'Cómputo (Lambda)',
    'Lambda requests and GB-seconds (arm64)',
  ),
  'cost.line.database-operations': tri(
    'Leer y guardar datos',
    'Lecturas y escrituras de la base de datos (DynamoDB)',
    'DynamoDB read and write request units',
  ),
  'cost.line.database-storage': tri(
    'Guardar datos y sus copias de seguridad',
    'Almacenamiento y respaldos de la base de datos (DynamoDB)',
    'DynamoDB storage and point-in-time recovery',
  ),
  'cost.line.file-storage': tri(
    'Guardar archivos',
    'Almacenamiento de archivos (S3)',
    'S3 storage',
  ),
  'cost.line.sign-in': tri(
    'Permitir que la gente inicie sesión',
    'Usuarios que inician sesión (Cognito)',
    'Cognito monthly active users',
  ),
  'cost.line.logs': tri(
    'Llevar un diario de lo ocurrido',
    'Registros (CloudWatch)',
    'CloudWatch Logs ingestion and storage',
  ),

  // ---- razones: planificador -------------------------------------------------------------
  'rationale.strategy.static': tri(
    'Es un sitio web sin nada ejecutándose detrás, así que basta la opción más sencilla.',
    'Solo se encontró un sitio web, así que el alojamiento estático es la opción más sencilla que funciona.',
    'Solo componentes de sitio estático; la estrategia más baja satisface el spec.',
  ),
  'rationale.strategy.serverless': tri(
    'Parte de la aplicación necesita un programa o datos detrás del sitio, así que corre en servicios de pago por uso.',
    'Algo necesita un backend, así que Hero subió de alojamiento estático a serverless, la siguiente opción más sencilla.',
    'Una capacidad de backend subió el plan por encima de static: serverless es la estrategia más baja que la satisface.',
  ),
  'rationale.strategy.needs-container': tri(
    'Esta aplicación necesita algo que debe correr todo el tiempo, y Hero todavía no puede hacerlo.',
    'Esta aplicación necesita un programa continuo o un motor de base de datos. Eso requiere contenedores, que llegan en una versión posterior.',
    'Las capacidades requieren strategy=container; no implementada en esta versión.',
  ),
  'rationale.frontend.static-site': tri(
    'Tu sitio se guardará y se servirá en todo el mundo.',
    'El sitio se construye una vez y se sirve desde una red de entrega global.',
    'Frontend como S3 + CloudFront.',
  ),
  'rationale.service.http.serverless': tri(
    'Tu programa arrancará solo cuando alguien lo visite.',
    'El servicio web corre como una función detrás de una API HTTP, así que pagas solo cuando se usa.',
    'Servicio HTTP como API Gateway HTTP API + Lambda (arm64).',
  ),
  'rationale.service.scheduled.serverless': tri(
    'Tu trabajo programado correrá a las horas indicadas.',
    'La tarea programada corre como una función que arranca un programador.',
    'Tarea programada como EventBridge Scheduler + Lambda.',
  ),
  'rationale.data.key-value.on-demand': tri(
    'Tus datos viven en un almacén sencillo que crece contigo.',
    'Los datos clave-valor van a DynamoDB con facturación bajo demanda, sin capacidad que administrar.',
    'Tabla DynamoDB bajo demanda.',
  ),
  'rationale.storage.object.private': tri(
    'Tus archivos se mantienen privados.',
    'Los archivos van a un bucket privado que no es accesible desde internet.',
    'Bucket S3 con Block Public Access.',
  ),
  'rationale.auth.user-pool': tri(
    'La gente podrá iniciar sesión.',
    'El inicio de sesión de usuarios lo da un grupo de usuarios de Cognito.',
    'Grupo de usuarios y cliente de Cognito.',
  ),
  'rationale.guardrail.budget': tri(
    'Recibirás un correo si el gasto crece.',
    'Una alerta de presupuesto te escribe cuando el gasto llega al 80% del límite mensual.',
    'AWS Budget: límite mensual con alerta al 80%.',
  ),
  'rationale.input.secret': tri(
    '{name} es un secreto y se guarda cifrado.',
    '{name} parece un secreto y se guardará cifrado.',
    'Entrada {name}: secreto (SSM SecureString).',
  ),
  'rationale.input.config': tri(
    '{name} es un ajuste.',
    '{name} es un ajuste que la aplicación lee.',
    'Entrada {name}: config (SSM String).',
  ),
  'rationale.input.budget-email': tri(
    'El correo que recibe las alertas de gasto.',
    'A dónde se envían las alertas de presupuesto. Se queda en tu cuenta de AWS.',
    'Suscriptor de notificaciones del presupuesto.',
  ),

  // ---- razones: AWS ----------------------------------------------------------------------
  'rationale.guardrail.private-by-default': tri(
    'Privado por defecto.',
    'Nada es público salvo que deba serlo.',
    'Block Public Access activado.',
  ),
  'rationale.guardrail.encryption': tri(
    'Cifrado.',
    'Los datos se cifran en reposo.',
    'Cifrado en reposo.',
  ),
  'rationale.guardrail.https-only': tri(
    'Solo conexiones seguras.',
    'Solo se acepta HTTPS, con cifrado moderno.',
    'Solo HTTPS, TLS 1.2 o superior.',
  ),
  'rationale.guardrail.least-privilege': tri(
    'Tu programa recibe solo los permisos que necesita.',
    'El rol permite solo lo que este programa necesita, y solo en este despliegue.',
    'Mínimo privilegio de IAM con límite de permisos.',
  ),
  'rationale.guardrail.log-retention': tri(
    'Los registros se guardan 30 días y luego se borran.',
    'Los registros se guardan 30 días para que no crezcan sin límite.',
    'Retención de logs de 30 días.',
  ),
  'rationale.guardrail.backups': tri(
    'Tus datos tienen copia de seguridad.',
    'Los respaldos a un punto en el tiempo permiten recuperar datos de los últimos 35 días.',
    'PITR de DynamoDB activo; protección contra borrado activa.',
  ),
  'rationale.guardrail.versioning': tri(
    'Se conservan versiones anteriores de los archivos.',
    'El control de versiones conserva versiones anteriores para poder deshacer una sobrescritura.',
    'Versionado de S3 activado.',
  ),
  'rationale.guardrail.secret-store': tri(
    'Los secretos se guardan en un lugar seguro.',
    'Los secretos se guardan en el almacén seguro de parámetros, no en el código.',
    'SSM SecureString.',
  ),
  'rationale.cost.assumption.traffic': tri(
    'De {low} a {high} peticiones al mes.',
    'Se supone un tráfico de {low} a {high} peticiones al mes.',
    'requests/month: {low}..{high}',
  ),
  'rationale.cost.assumption.function': tri(
    'Los programas usan {memoryMb} MB de memoria.',
    'Se supone que las funciones usan {memoryMb} MB en procesadores {architecture}.',
    'Lambda {memoryMb} MB, {architecture}.',
  ),
  'rationale.cost.assumption.free-tier': tri(
    'Se incluyen las asignaciones gratuitas mensuales que da AWS.',
    'Las asignaciones mensuales siempre gratuitas de AWS se descuentan antes de cobrar.',
    'Asignaciones siempre gratuitas aplicadas (Lambda, DynamoDB, CloudWatch, Cognito, CloudFront).',
  ),
  'rationale.cost.assumption.no-domain': tri(
    'No se incluye una dirección web propia.',
    'No se incluyen un nombre de dominio propio ni su DNS.',
    'Route 53 y registro de dominio excluidos.',
  ),
  'rationale.cost.assumption.region-prices': tri(
    'Precios de {region}.',
    'Precios de {region}, {source}, publicados {asOf}.',
    'prices region={region} source={source} asOf={asOf}',
  ),

  // ---- evidencia y capacidades añadidas para los planes ----------------------------------
  'evidence.capability': tri('', 'necesita {value}', 'capability {value}'),
  'capability.cost-control': tri(
    'una alerta de gasto',
    'una alerta de presupuesto',
    'cost-control',
  ),

  // ---- errores y preguntas añadidos para los planes --------------------------------------
  'error.plan.invalid-answer': tri(
    'Una de las respuestas que diste no es válida.',
    'La respuesta para "{question}" no es válida, o esa pregunta no existe.',
    'Respuesta inválida para {question}.',
  ),
  'error.plan.no-provider': tri(
    'Hero no tiene una nube para la que planificar.',
    'No hay ningún proveedor de nube configurado.',
    'No se proporcionó un puerto CloudProvider.',
  ),
  'question.data.keys-unknown': tri(
    'Hero necesita saber cómo se organizan tus datos antes de crear el lugar donde guardarlos.',
    'Una tabla debe crearse con una clave y el código no muestra cuál. Indica cómo se identifican los elementos, por ejemplo "id" o "pk:string,sk:string".',
    'No se encontró KeySchema, definición de esquema ni uso de Key para la tabla {table}. Responde nombre[:tipo][,nombre[:tipo]].',
  ),
  'question.data.keys-confirm': tri(
    'Hero dedujo cómo se organizan tus datos. Por favor comprueba que sea correcto.',
    'El código lee elementos por "{partition}", así que Hero creará la tabla con esa clave. La clave de una tabla no se puede cambiar después, así que confírmala.',
    'Clave deducida del uso para la tabla {table}: partición {partition}. Confirma o responde nombre[:tipo][,nombre[:tipo]].',
  ),
  'evidence.source.key-schema': tri(
    '',
    'el código declara la clave de la tabla',
    'source key-schema',
  ),
  'evidence.source.schema-definition': tri(
    '',
    'el modelo de datos declara la clave',
    'source schema-definition',
  ),
  'evidence.source.key-usage': tri(
    '',
    'el código lee los elementos por esa clave',
    'source key-usage',
  ),
  'question.scheduled.schedule-unknown': tri(
    'Hero no pudo saber cada cuánto debe correr tu trabajo programado.',
    'No se pudo leer en el código el horario de la tarea programada. Indica cuándo debe correr, en formato cron como "0 * * * *".',
    'No se encontró una expresión cron literal de cinco campos para el servicio programado.',
  ),
};
