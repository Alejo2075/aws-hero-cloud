/** Turns an id such as `orders-api` into `OrdersApi`, safe for a construct id or a parameter name. */
export function pascal(id: string): string {
  return id
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

/** The name of the permissions boundary Hero creates when it prepares an account. */
export const BOUNDARY_POLICY_NAME = 'hero-boundary';

/** The bootstrap qualifier, so Hero's toolkit resources never collide with the user's own CDK. */
export const BOOTSTRAP_QUALIFIER = 'herocloud';

/** The public Lambda Web Adapter layer (AWS Labs, account 753240598075), pinned to one version. */
export const WEB_ADAPTER_LAYER_VERSION = 30;
export const WEB_ADAPTER_ACCOUNT = '753240598075';

/** Where a deployment's settings and secrets live in the user's own parameter store. */
export function parameterPath(deploymentId: string): string {
  return `/hero/${deploymentId}/`;
}
