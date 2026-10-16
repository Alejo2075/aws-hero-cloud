import type { Message } from '../types.js';

const tri = (simple: string, guided: string, expert: string): Message => ({
  simple,
  guided,
  expert,
});

/** Everything said about a finished deployment and its health, in English. */
export const enResult: Readonly<Record<string, Message>> = {
  'view.section.plan-removes': 'What will be removed',
  'check.health.resource-state': tri(
    'The setup on AWS finished without errors.',
    "AWS reports that your app's resources were created and are in a finished state.",
    'CloudFormation stack status is CREATE_COMPLETE or UPDATE_COMPLETE ({target}).',
  ),
  'check.health.reachability': tri(
    'Your site answers when someone visits it.',
    'Hero opened {target} from the internet and it answered (code {statusCode}) in {latencyMs} ms.',
    'GET https://{target}/ → {statusCode} in {latencyMs} ms.',
  ),
  'check.health.reachability.timeout': tri(
    'Your site did not answer in time.',
    'Hero opened {target} but it did not answer within the time limit.',
    'GET https://{target}/ timed out.',
  ),
  'check.health.reachability.unreachable': tri(
    'Your site could not be reached.',
    'Hero could not connect to {target}.',
    'GET https://{target}/ failed to connect.',
  ),
  'check.health.reachability.redirect-off-host': tri(
    'Your site tried to send visitors somewhere else, so Hero stopped.',
    '{target} redirected to a different address. Hero only follows redirects within the same address.',
    'GET https://{target}/ → redirect to another host; not followed.',
  ),
  'check.health.reachability.redirect': tri(
    'Your site redirected without saying where.',
    '{target} answered with a redirect that has no destination.',
    'GET https://{target}/ → 3xx without Location.',
  ),
  'check.health.reachability.too-many-redirects': tri(
    'Your site keeps sending visitors in circles.',
    '{target} redirected more times than Hero follows.',
    'GET https://{target}/ exceeded the redirect limit.',
  ),
  'check.health.reachability.server-error': tri(
    'Your site answered with an error.',
    '{target} answered, but with an error (code {statusCode}).',
    'GET https://{target}/ → {statusCode}.',
  ),
  'check.health.smoke': tri(
    'A page your app named as its health page works.',
    'The page {target} that your app named for checking answered well (code {statusCode}).',
    'GET {target} → {statusCode} in {latencyMs} ms.',
  ),
  'check.health.smoke.timeout': tri(
    "Your app's health page did not answer in time.",
    '{target} did not answer within the time limit.',
    'GET {target} timed out.',
  ),
  'check.health.smoke.unreachable': tri(
    "Your app's health page could not be reached.",
    'Hero could not request {target}.',
    'GET {target} failed to connect.',
  ),
  'check.health.smoke.redirect-off-host': tri(
    "Your app's health page sent Hero somewhere else, so Hero stopped.",
    '{target} redirected to a different address and Hero did not follow it.',
    'GET {target} → redirect to another host; not followed.',
  ),
  'check.health.smoke.redirect': tri(
    "Your app's health page redirected without saying where.",
    '{target} answered with a redirect that has no destination.',
    'GET {target} → 3xx without Location.',
  ),
  'check.health.smoke.too-many-redirects': tri(
    "Your app's health page keeps redirecting.",
    '{target} redirected more times than Hero follows.',
    'GET {target} exceeded the redirect limit.',
  ),
  'check.health.smoke.bad-status': tri(
    "Your app's health page reported a problem.",
    '{target} answered with an error (code {statusCode}).',
    'GET {target} → {statusCode}.',
  ),
  'rationale.next.open-site': tri(
    'Open your site and try it.',
    'Open the address above and try the main things your app does. Hero can only check from the outside.',
    'Open the endpoints above and exercise the application; health checks are external only.',
  ),
  'rationale.next.check-health': tri(
    'Something is not working yet. Look at what failed above.',
    'Not every check passed. Read the failed checks above, then run the health check again.',
    'One or more checks failed or were not run; fix and re-run `hero-cloud health`.',
  ),
  'rationale.next.set-secrets': tri(
    'Your app needs private settings (like passwords) before it can fully work.',
    'Your app expects secrets that Hero does not store. Put them in the secure parameter store at the locations listed.',
    'Secret values are not set by this deployment; write them to the SSM SecureString paths listed.',
  ),
  'rationale.next.watch-cost': tri(
    'Keep an eye on what it costs. You will get an email if spending grows.',
    'Check the cost page now and then. The spending alert will email you when you pass your limit.',
    'Review Cost Explorer; the budget notifies at the configured threshold.',
  ),
  'rationale.next.destroy': tri(
    'When you no longer need it, you can remove it with one command.',
    'You can remove everything Hero created with `hero-cloud destroy`. You will see exactly what goes before anything is deleted.',
    '`hero-cloud destroy` produces a destroy plan that needs approval; retained resources are listed.',
  ),
  'rationale.next.review-kept-data': tri(
    'Some of your data was kept on purpose. Delete it yourself when you are sure.',
    'Hero keeps data stores and file buckets when it removes an app, so nothing is lost by mistake. Delete them from the AWS console when you are sure.',
    'Resources with DeletionPolicy Retain remain in the account and are billed until removed manually.',
  ),
  'warning.plan.destroy-keeps-data': tri(
    'Some of your data will be kept, not deleted.',
    '{count} resource(s) that hold your data are kept when you remove this app, so nothing is lost by mistake. They keep costing a little until you delete them.',
    '{count} resource(s) have DeletionPolicy Retain and remain after destroy.',
  ),
  'view.result.title': 'Your deployment: {id}',
  'view.result.status.succeeded': tri(
    'Done. Your app is online and the checks below passed.',
    'Deployed. Hero checked it from the outside and the checks below passed.',
    'Deployment succeeded; all executed checks passed.',
  ),
  'view.result.status.partial': tri(
    'Your app was set up, but something is not working yet.',
    'The resources were created, but not every check passed. See the checks below.',
    'Deployed; health is not fully healthy. See checks.',
  ),
  'view.result.status.failed': tri(
    'The deployment did not work.',
    'The deployment failed.',
    'Deployment failed.',
  ),
  'view.result.status.rolled-back': tri(
    'The deployment did not work, so Hero put things back as they were.',
    'The deployment failed and was rolled back.',
    'Deployment failed; stack rolled back.',
  ),
  'view.result.removed': tri(
    'Done. Hero removed your app from AWS.',
    'Removal finished. The resources of this deployment were deleted, except any listed as kept.',
    'Destroy completed; retained resources listed.',
  ),
  'view.section.result-reach': 'How to reach it',
  'view.section.result-health': 'Is it working?',
  'view.section.result-cost': 'What it should cost',
  'view.section.result-links': 'Where to look',
  'view.section.result-next': 'What to do next',
  'view.section.result-resources': 'What was created',
  'view.section.result-kept': 'What was kept',
  'view.section.result-secrets': 'Where your secrets go',
  'view.result.no-endpoints': 'Nothing here can be opened from the internet.',
  'view.result.cost-line': tri(
    'It should cost about {low} to {high} a month.',
    'Estimated {low} to {high} a month (a range, not a promise).',
    'Monthly estimate: {low}..{high} USD.',
  ),
  'view.endpoint.website': 'Your website',
  'view.endpoint.api': 'Your API',
  'view.link.cloudformation': 'The setup in AWS',
  'view.link.logs': 'What your app prints (logs)',
  'view.link.cost': 'Your spending',
  'view.health.title': 'Health of {id}',
  'view.health.status.healthy': tri(
    'Working. Every check Hero ran passed.',
    'Healthy: every check that ran passed.',
    'healthy',
  ),
  'view.health.status.degraded': tri(
    'Partly working. Some checks failed.',
    'Degraded: some checks passed and some failed.',
    'degraded',
  ),
  'view.health.status.down': tri(
    'Not working. The checks failed.',
    'Down: the checks that ran failed.',
    'down',
  ),
  'view.health.status.unknown': tri(
    'Hero could not check yet.',
    'Unknown: no check could run.',
    'unknown',
  ),
  'view.health.limits': tri(
    'This shows what Hero can see from the outside. It cannot tell whether every feature of your app works.',
    "These checks look at the setup and at public addresses from outside. They do not test your app's features, logins, or data.",
    'External observation only: stack state, reachability, and named smoke paths. No functional or data checks.',
  ),
  'view.health.checked-at': 'Checked at {time}',
  'view.health.col-check': 'Check',
  'view.health.col-result': 'Result',
  'view.health.col-component': 'Part',
  'view.health.col-what': 'What was seen',
  'health.check-status.passed': 'passed',
  'health.check-status.failed': 'failed',
  'health.check-status.skipped': 'not checked',
  'view.destroy.title': 'Removing {name}',
  'view.destroy.summary': tri(
    'Hero will remove {name} from your AWS account. Nothing is removed until you approve.',
    'Hero planned the removal of {name} from your AWS account. Nothing is deleted until you approve exactly this plan.',
    'Destroy plan for {name}: account={account}, region={region}. No resource is deleted without an Approval bound to this digest.',
  ),
  'warning.plan.update-unverified': tri(
    'Hero could not check what is already online, so this list may show things that already exist.',
    'Hero could not compare this plan with what is deployed ({reasonText}). Items are listed as if they were new; some may already exist or be replaced.',
    'Diff unavailable ({reason}); the changes shown are the synthesized template, not a change set.',
  ),
  'warning.plan.destructive-changes': tri(
    'Some parts will be replaced or removed, and what they hold could be lost.',
    '{count} change(s) replace or delete something that exists now. Check the list before you approve; data in a replaced resource can be lost.',
    '{count} change(s) are replace or delete actions on existing resources.',
  ),
  'view.section.plan-destructive': 'Parts that will be replaced or removed',
  'view.plan.destructive': tri(
    '{count} part(s) of your app will be replaced or removed. What they hold could be lost.',
    '{count} existing resource(s) will be replaced or removed:',
    '{count} destructive change(s):',
  ),
  'check.health.drift': tri(
    'Nobody has changed your setup by hand.',
    'AWS compared your resources with what Hero created and found no differences.',
    'CloudFormation drift detection: IN_SYNC.',
  ),
  'check.health.drift.drifted': tri(
    'Something in your setup was changed outside Hero.',
    'AWS found resources that differ from what Hero created, which usually means someone changed them by hand. Updating through Hero may undo those changes.',
    'CloudFormation drift detection: DRIFTED.',
  ),
  'check.health.drift.unavailable': tri(
    'Hero could not check whether your setup was changed by hand.',
    'The drift check did not finish or was not allowed, so Hero does not know whether the resources still match.',
    'Drift detection did not complete (denied, failed, or timed out); status unknown.',
  ),
  'update.reason.offline': 'you chose not to use the network',
  'update.reason.unsupported': 'this cloud cannot compare',
  'update.reason.failed': 'the comparison failed',
  'update.reason.no-account': 'there is no verified account',
};
