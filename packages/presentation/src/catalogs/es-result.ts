import type { Message } from '../types.js';

const tri = (simple: string, guided: string, expert: string): Message => ({
  simple,
  guided,
  expert,
});

/** Todo lo que se dice de un despliegue terminado y de su salud, en español. */
export const esResult: Readonly<Record<string, Message>> = {
  'view.section.plan-removes': 'Qué se va a quitar',
  'check.health.resource-state': tri(
    'La preparación en AWS terminó sin errores.',
    'AWS informa que los recursos de tu app se crearon y están en un estado terminado.',
    'El estado del stack de CloudFormation es CREATE_COMPLETE o UPDATE_COMPLETE ({target}).',
  ),
  'check.health.reachability': tri(
    'Tu sitio responde cuando alguien lo visita.',
    'Hero abrió {target} desde internet y respondió (código {statusCode}) en {latencyMs} ms.',
    'GET https://{target}/ → {statusCode} en {latencyMs} ms.',
  ),
  'check.health.reachability.timeout': tri(
    'Tu sitio no respondió a tiempo.',
    'Hero abrió {target} pero no respondió dentro del tiempo límite.',
    'GET https://{target}/ agotó el tiempo.',
  ),
  'check.health.reachability.unreachable': tri(
    'No se pudo llegar a tu sitio.',
    'Hero no pudo conectarse a {target}.',
    'GET https://{target}/ no pudo conectar.',
  ),
  'check.health.reachability.redirect-off-host': tri(
    'Tu sitio intentó enviar a los visitantes a otro lugar, así que Hero se detuvo.',
    '{target} redirigió a otra dirección. Hero solo sigue redirecciones dentro de la misma dirección.',
    'GET https://{target}/ → redirección a otro host; no se siguió.',
  ),
  'check.health.reachability.redirect': tri(
    'Tu sitio redirigió sin decir a dónde.',
    '{target} respondió con una redirección sin destino.',
    'GET https://{target}/ → 3xx sin Location.',
  ),
  'check.health.reachability.too-many-redirects': tri(
    'Tu sitio manda a los visitantes en círculos.',
    '{target} redirigió más veces de las que Hero sigue.',
    'GET https://{target}/ superó el límite de redirecciones.',
  ),
  'check.health.reachability.server-error': tri(
    'Tu sitio respondió con un error.',
    '{target} respondió, pero con un error (código {statusCode}).',
    'GET https://{target}/ → {statusCode}.',
  ),
  'check.health.smoke': tri(
    'Una página que tu app indicó para comprobarse funciona.',
    'La página {target} que tu app indicó para comprobarse respondió bien (código {statusCode}).',
    'GET {target} → {statusCode} en {latencyMs} ms.',
  ),
  'check.health.smoke.timeout': tri(
    'La página de salud de tu app no respondió a tiempo.',
    '{target} no respondió dentro del tiempo límite.',
    'GET {target} agotó el tiempo.',
  ),
  'check.health.smoke.unreachable': tri(
    'No se pudo llegar a la página de salud de tu app.',
    'Hero no pudo consultar {target}.',
    'GET {target} no pudo conectar.',
  ),
  'check.health.smoke.redirect-off-host': tri(
    'La página de salud de tu app envió a Hero a otro lugar, así que se detuvo.',
    '{target} redirigió a otra dirección y Hero no la siguió.',
    'GET {target} → redirección a otro host; no se siguió.',
  ),
  'check.health.smoke.redirect': tri(
    'La página de salud de tu app redirigió sin decir a dónde.',
    '{target} respondió con una redirección sin destino.',
    'GET {target} → 3xx sin Location.',
  ),
  'check.health.smoke.too-many-redirects': tri(
    'La página de salud de tu app redirige sin parar.',
    '{target} redirigió más veces de las que Hero sigue.',
    'GET {target} superó el límite de redirecciones.',
  ),
  'check.health.smoke.bad-status': tri(
    'La página de salud de tu app reportó un problema.',
    '{target} respondió con un error (código {statusCode}).',
    'GET {target} → {statusCode}.',
  ),
  'rationale.next.open-site': tri(
    'Abre tu sitio y pruébalo.',
    'Abre la dirección de arriba y prueba lo principal que hace tu app. Hero solo puede comprobar desde fuera.',
    'Abre los endpoints de arriba y prueba la aplicación; las comprobaciones de salud son solo externas.',
  ),
  'rationale.next.check-health': tri(
    'Algo todavía no funciona. Mira lo que falló arriba.',
    'No todas las comprobaciones pasaron. Lee las que fallaron arriba y vuelve a comprobar la salud.',
    'Una o más comprobaciones fallaron o no se ejecutaron; corrige y vuelve a ejecutar `hero-cloud health`.',
  ),
  'rationale.next.set-secrets': tri(
    'Tu app necesita ajustes privados (como contraseñas) para funcionar del todo.',
    'Tu app espera secretos que Hero no guarda. Colócalos en el almacén seguro de parámetros en las ubicaciones indicadas.',
    'Los valores secretos no los fija este despliegue; escríbelos en las rutas SSM SecureString indicadas.',
  ),
  'rationale.next.watch-cost': tri(
    'Vigila lo que cuesta. Recibirás un correo si el gasto crece.',
    'Revisa la página de costos de vez en cuando. La alerta de gasto te enviará un correo al pasar tu límite.',
    'Revisa Cost Explorer; el presupuesto notifica al llegar al umbral configurado.',
  ),
  'rationale.next.destroy': tri(
    'Cuando ya no lo necesites, puedes quitarlo con un solo comando.',
    'Puedes quitar todo lo que Hero creó con `hero-cloud destroy`. Verás exactamente qué se elimina antes de borrar nada.',
    '`hero-cloud destroy` genera un plan de destrucción que requiere aprobación; los recursos conservados se listan.',
  ),
  'rationale.next.review-kept-data': tri(
    'Parte de tus datos se conservó a propósito. Bórrala tú mismo cuando estés seguro.',
    'Hero conserva las bases de datos y los buckets al quitar una app, para no perder nada por error. Bórralos desde la consola de AWS cuando estés seguro.',
    'Los recursos con DeletionPolicy Retain permanecen en la cuenta y se facturan hasta que se eliminen a mano.',
  ),
  'warning.plan.destroy-keeps-data': tri(
    'Parte de tus datos se conservará, no se borrará.',
    '{count} recurso(s) que guardan tus datos se conservan al quitar esta app, para no perder nada por error. Siguen costando un poco hasta que los borres.',
    '{count} recurso(s) tienen DeletionPolicy Retain y permanecen tras destruir.',
  ),
  'view.result.title': 'Tu despliegue: {id}',
  'view.result.status.succeeded': tri(
    'Listo. Tu app está en línea y las comprobaciones de abajo pasaron.',
    'Desplegado. Hero lo comprobó desde fuera y las comprobaciones de abajo pasaron.',
    'Despliegue exitoso; todas las comprobaciones ejecutadas pasaron.',
  ),
  'view.result.status.partial': tri(
    'Tu app se preparó, pero algo todavía no funciona.',
    'Los recursos se crearon, pero no todas las comprobaciones pasaron. Mira las comprobaciones de abajo.',
    'Desplegado; la salud no es completamente saludable. Ver comprobaciones.',
  ),
  'view.result.status.failed': tri(
    'El despliegue no funcionó.',
    'El despliegue falló.',
    'El despliegue falló.',
  ),
  'view.result.status.rolled-back': tri(
    'El despliegue no funcionó, así que Hero dejó todo como estaba.',
    'El despliegue falló y se revirtió.',
    'El despliegue falló; el stack se revirtió.',
  ),
  'view.result.removed': tri(
    'Listo. Hero quitó tu app de AWS.',
    'Eliminación terminada. Los recursos de este despliegue se borraron, salvo los indicados como conservados.',
    'Destrucción completada; recursos retenidos listados.',
  ),
  'view.section.result-reach': 'Cómo llegar a él',
  'view.section.result-health': '¿Está funcionando?',
  'view.section.result-cost': 'Cuánto debería costar',
  'view.section.result-links': 'Dónde mirar',
  'view.section.result-next': 'Qué hacer ahora',
  'view.section.result-resources': 'Qué se creó',
  'view.section.result-kept': 'Qué se conservó',
  'view.section.result-secrets': 'Dónde van tus secretos',
  'view.result.no-endpoints': 'Nada de esto se puede abrir desde internet.',
  'view.result.cost-line': tri(
    'Debería costar entre {low} y {high} al mes.',
    'Estimado: de {low} a {high} al mes (un rango, no una promesa).',
    'Estimación mensual: {low}..{high} USD.',
  ),
  'view.endpoint.website': 'Tu sitio web',
  'view.endpoint.api': 'Tu API',
  'view.link.cloudformation': 'La preparación en AWS',
  'view.link.logs': 'Lo que imprime tu app (logs)',
  'view.link.cost': 'Tu gasto',
  'view.health.title': 'Salud de {id}',
  'view.health.status.healthy': tri(
    'Funcionando. Todas las comprobaciones de Hero pasaron.',
    'Saludable: todas las comprobaciones ejecutadas pasaron.',
    'healthy',
  ),
  'view.health.status.degraded': tri(
    'Funciona en parte. Algunas comprobaciones fallaron.',
    'Degradado: algunas comprobaciones pasaron y otras fallaron.',
    'degraded',
  ),
  'view.health.status.down': tri(
    'No funciona. Las comprobaciones fallaron.',
    'Caído: las comprobaciones ejecutadas fallaron.',
    'down',
  ),
  'view.health.status.unknown': tri(
    'Hero todavía no pudo comprobarlo.',
    'Desconocido: ninguna comprobación pudo ejecutarse.',
    'unknown',
  ),
  'view.health.limits': tri(
    'Esto muestra lo que Hero puede ver desde fuera. No puede saber si cada función de tu app anda bien.',
    'Estas comprobaciones miran la preparación y las direcciones públicas desde fuera. No prueban las funciones, los accesos ni los datos de tu app.',
    'Solo observación externa: estado del stack, alcanzabilidad y rutas de humo indicadas. Sin comprobaciones funcionales ni de datos.',
  ),
  'view.health.checked-at': 'Comprobado el {time}',
  'view.health.col-check': 'Comprobación',
  'view.health.col-result': 'Resultado',
  'view.health.col-component': 'Parte',
  'view.health.col-what': 'Qué se vio',
  'health.check-status.passed': 'pasó',
  'health.check-status.failed': 'falló',
  'health.check-status.skipped': 'no se comprobó',
  'view.destroy.title': 'Quitar {name}',
  'view.destroy.summary': tri(
    'Hero quitará {name} de tu cuenta de AWS. No se quita nada hasta que lo apruebes.',
    'Hero planificó quitar {name} de tu cuenta de AWS. No se borra nada hasta que apruebes exactamente este plan.',
    'Plan de destrucción de {name}: cuenta={account}, región={region}. No se borra ningún recurso sin una Approval ligada a este digest.',
  ),
};
