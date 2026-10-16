import type { Message } from '../types.js';

const tri = (simple: string, guided: string, expert: string): Message => ({
  simple,
  guided,
  expert,
});

/** Everything said about a plan, in English. Merged into the English catalog. */
export const enPlan: Readonly<Record<string, Message>> = {
  // ---- view labels -----------------------------------------------------------------------
  'view.plan.title': 'Your plan for {name}',
  'view.plan.summary': tri(
    'Hero can put {name} online on your own AWS account. Nothing has been created yet.',
    'Hero planned {name} for your AWS account using the "{strategy}" approach. Nothing has been created yet.',
    '{name}: strategy={strategy}, account={account}, region={region}.',
  ),
  'view.plan.nothing-created': tri(
    'Nothing is created until you read this plan and approve it.',
    'Nothing is created until you approve exactly this plan. A change to it needs a new approval.',
    'No resource is created without an Approval bound to this digest, account, and region.',
  ),
  'view.section.plan-summary': 'Summary',
  'view.section.plan-blocking': 'Before this can go online',
  'view.section.plan-creates': 'What will be created',
  'view.section.plan-safeguards': 'Safe by default',
  'view.section.plan-cost': 'What it should cost',
  'view.section.plan-warnings': 'Good to know',
  'view.section.plan-inputs': 'What you need to provide',
  'view.section.plan-changes': 'Changes',
  'view.section.plan-rationale': 'Why each change',
  'view.section.plan-details': 'Resource settings',
  'view.section.plan-seal': 'Seal',
  'view.plan.ready': tri(
    'This plan is ready to approve.',
    'No blocking issues were found. You can approve this plan.',
    'No blocking warnings. The plan can be approved.',
  ),
  'view.plan.strategy-reason': 'Why this approach',
  'view.plan.inputs.count': tri(
    'Settings you will need to provide: {count}.',
    'The application reads {count} setting(s). Their names are listed below; the values never leave your machine.',
    'requiredInputs: {count}.',
  ),
  'view.plan.inputs.secrets': tri(
    'Secrets among them: {count}. Hero stores them encrypted in your own AWS account.',
    'Secrets among them: {count}. They will be stored encrypted (SSM Parameter Store, SecureString).',
    'Secret inputs: {count}. Values are written directly to SSM; never to plans, logs, or state.',
  ),
  'view.plan.cost.free': tri(
    'It should cost almost nothing: less than {high} a month.',
    'Expected cost: less than {high} a month for a quiet to busy small application.',
    'monthly {low} to {high} ({confidence} confidence)',
  ),
  'view.plan.cost.range': tri(
    'It should cost about {low} to {high} a month.',
    'Expected cost: about {low} to {high} a month, from nearly idle to busy.',
    'monthly {low} to {high} ({confidence} confidence)',
  ),
  'view.plan.cost.confidence': tri(
    '',
    'How sure: {confidence}. Prices are {source}.',
    'confidence={confidence}, prices={source} as of {asOf}',
  ),
  'view.plan.cost.note': tri(
    'This is an estimate, not a promise. The real cost depends on how many people use it.',
    'This is an estimate. The real cost depends on traffic, which nobody can know beforehand.',
    'Estimate only. Usage is assumed, see assumptions.',
  ),
  'view.plan.cost.source.live': "today's published AWS prices",
  'view.plan.cost.source.cache': 'recent published AWS prices',
  'view.plan.cost.source.built-in': 'prices built into Hero (not checked today)',
  'cost.confidence.low': 'low',
  'cost.confidence.medium': 'medium',
  'cost.confidence.high': 'high',
  'cost.reason.offline': 'you chose not to use the network',
  'cost.reason.prices-unavailable': 'AWS prices could not be reached',
  'column.action': 'Action',
  'column.type': 'Type',
  'column.name': 'Name',
  'column.destructive': 'Destructive',
  'column.severity': 'Severity',
  'column.kind': 'Kind',
  'column.low': 'Low',
  'column.high': 'High',
  'column.item': 'Item',
  'meta.digest': 'Plan digest',
  'meta.artifact': 'Artifact hash',
  'meta.source': 'Source hash',
  'meta.account': 'Account',
  'meta.region': 'Region',
  'meta.strategy': 'Strategy',
  'severity.blocking': 'blocking',
  'severity.warning': 'warning',
  'severity.info': 'info',
  'action.create': 'create',
  'action.update': 'update',
  'action.replace': 'replace',
  'action.delete': 'delete',
  'input.kind.secret': 'secret',
  'input.kind.config': 'setting',

  // ---- strategies ------------------------------------------------------------------------
  'strategy.name.static': tri('a simple website', 'static hosting', 'static'),
  'strategy.name.serverless': tri('pay-per-use hosting', 'serverless', 'serverless'),
  'strategy.name.container': tri('a program running all the time', 'containers', 'container'),
  'strategy.name.virtual-machine': tri(
    'a whole computer of its own',
    'a virtual machine',
    'virtual-machine',
  ),

  // ---- warnings --------------------------------------------------------------------------
  'warning.plan.account-unverified': tri(
    'Hero does not know which AWS account this is for yet, so this is only a preview.',
    'No AWS account was verified, so this plan is a preview and cannot be approved.',
    'accountId unverified (000000000000): the plan cannot be approved or deployed.',
  ),
  'warning.plan.open-question': tri(
    'Hero needs an answer from you first.',
    'A question about your project is still open: {kind}.',
    'Unresolved open question {question} ({kind}).',
  ),
  'warning.plan.unsupported-capability': tri(
    'This application needs {capabilityName}, which Hero cannot put online yet.',
    'This application needs {capabilityName}. That requires {strategyName}, which this version of Hero does not support yet.',
    'capability {capability} requires strategy {needs}: not implemented.',
  ),
  'warning.plan.public-exposure': tri(
    'Once online, anyone on the internet will be able to open it.',
    'The result will be reachable by anyone on the internet unless you add sign-in.',
    'Public endpoints: {kinds}.',
  ),
  'warning.plan.cost-low-confidence': tri(
    'The price is a rougher guess than usual.',
    "Hero could not use today's AWS prices ({reasonText}), so the cost is rougher than usual.",
    'Built-in prices used (reason={reason}, region={region}).',
  ),
  'warning.plan.ssr-cold-start': tri(
    'The first visit after a quiet time can be slower.',
    'Pages are rendered by a function that sleeps when idle, so the first visit after a quiet time can take a few seconds.',
    'Server rendering on Lambda: expect cold starts.',
  ),
  'warning.plan.scheduled-inside-server': tri(
    'Your scheduled work and your website share one program.',
    'A scheduler runs inside a web server. Hero will not split them on its own.',
    'Scheduler and server share a process.',
  ),
  'warning.plan.secrets-required': tri(
    'You will need to provide {count} secret(s) before going online.',
    '{count} secret(s) must be provided at deploy time. They are stored encrypted in your account.',
    'Secret inputs required: {count}.',
  ),
  'warning.plan.nothing-to-deploy': tri(
    'Hero found nothing to put online in this project.',
    'The analysis found no website, service, data, or storage to deploy.',
    'No deployable component in the effective Hero Spec.',
  ),

  // ---- resources -------------------------------------------------------------------------
  'resource.s3-bucket': tri(
    'A private folder for files',
    'S3 bucket (private storage)',
    'aws:s3:Bucket',
  ),
  'resource.cloudfront-distribution': tri(
    'A fast, secure web address for your site',
    'CloudFront distribution (global delivery)',
    'aws:cloudfront:Distribution',
  ),
  'resource.apigatewayv2-api': tri(
    'The public address of your program',
    'API Gateway HTTP API (public endpoint)',
    'aws:apigatewayv2:Api',
  ),
  'resource.lambda-function': tri(
    'Your program, running only when needed',
    'Lambda function (runs your code on demand)',
    'aws:lambda:Function',
  ),
  'resource.iam-role': tri(
    'Limited permissions for your program',
    'IAM role (least privilege)',
    'aws:iam:Role',
  ),
  'resource.logs-log-group': tri(
    'A diary of what happened, kept for 30 days',
    'CloudWatch log group (30 days)',
    'aws:logs:LogGroup',
  ),
  'resource.scheduler-schedule': tri(
    'The timetable that starts your program',
    'EventBridge Scheduler schedule',
    'aws:scheduler:Schedule',
  ),
  'resource.dynamodb-table': tri(
    'A place to keep your data, with backups',
    'DynamoDB table (on-demand, with point-in-time backups)',
    'aws:dynamodb:Table',
  ),
  'resource.cognito-user-pool': tri(
    'Sign-in for your users',
    'Cognito user pool (sign-in)',
    'aws:cognito:UserPool',
  ),
  'resource.cognito-user-pool-client': tri(
    'The link between your app and sign-in',
    'Cognito app client',
    'aws:cognito:UserPoolClient',
  ),
  'resource.budgets-budget': tri(
    'An alert if spending grows',
    'AWS Budget (email alert)',
    'aws:budgets:Budget',
  ),
  'resource.ssm-parameter': tri(
    'A safe place for one setting',
    'SSM parameter (encrypted when secret)',
    'aws:ssm:Parameter',
  ),

  'resource.s3-bucket-policy': tri(
    'Rules that keep the folder private',
    'S3 bucket policy (secure connections only)',
    'aws:s3:BucketPolicy',
  ),
  'resource.cloudfront-access-control': tri(
    'A key so only your web address can open the files',
    'CloudFront origin access control',
    'aws:cloudfront:OriginAccessControl',
  ),
  'resource.apigatewayv2-stage': tri(
    'The live version of the public address',
    'API Gateway stage (access logs and request limits)',
    'aws:apigatewayv2:Stage',
  ),
  'resource.apigatewayv2-integration': tri(
    'The link from the address to your program',
    'API Gateway integration',
    'aws:apigatewayv2:Integration',
  ),
  'resource.apigatewayv2-route': tri(
    'The path that sends visitors to your program',
    'API Gateway route',
    'aws:apigatewayv2:Route',
  ),
  'resource.lambda-permission': tri(
    'Permission for the address to start your program',
    'Lambda invoke permission',
    'aws:lambda:Permission',
  ),
  'resource.iam-policy': tri(
    'The list of what your program may do',
    'IAM policy (least privilege)',
    'aws:iam:Policy',
  ),
  'resource.other-resource': tri('A supporting piece', 'Supporting resource', 'aws:other'),
  'warning.plan.unsupported-schedule': tri(
    'Hero could not set that timetable exactly, so it did not schedule {job}.',
    'The schedule of "{job}" cannot be expressed exactly in AWS (for example, it mixes a day of the month with a weekday), so no schedule was created.',
    'Schedule of {job} has no exact EventBridge equivalent; no scheduler resource was planned.',
  ),

  // ---- cost lines ------------------------------------------------------------------------
  'cost.line.static-storage': tri('Keeping your website', 'Website storage (S3)', 'S3 storage'),
  'cost.line.static-origin-requests': tri(
    'Serving your website',
    'Requests from the CDN to storage (S3)',
    'S3 GET requests',
  ),
  'cost.line.cdn-delivery': tri(
    'Delivering your website to visitors',
    'Delivery to visitors (CloudFront)',
    'CloudFront data transfer and requests',
  ),
  'cost.line.api-requests': tri(
    'Answering requests',
    'API requests (API Gateway)',
    'API Gateway HTTP API requests',
  ),
  'cost.line.function-compute': tri(
    'Running your program',
    'Compute (Lambda)',
    'Lambda requests and GB-seconds (arm64)',
  ),
  'cost.line.database-operations': tri(
    'Reading and saving data',
    'Database reads and writes (DynamoDB)',
    'DynamoDB read and write request units',
  ),
  'cost.line.database-storage': tri(
    'Keeping data and its backups',
    'Database storage and backups (DynamoDB)',
    'DynamoDB storage and point-in-time recovery',
  ),
  'cost.line.file-storage': tri('Keeping files', 'File storage (S3)', 'S3 storage'),
  'cost.line.sign-in': tri(
    'Letting people sign in',
    'Sign-in users (Cognito)',
    'Cognito monthly active users',
  ),
  'cost.line.logs': tri(
    'Keeping a diary of what happened',
    'Logs (CloudWatch)',
    'CloudWatch Logs ingestion and storage',
  ),

  // ---- rationale: planner ----------------------------------------------------------------
  'rationale.strategy.static': tri(
    'It is a website with nothing running behind it, so the simplest option is enough.',
    'Only a website was found, so plain static hosting is the simplest option that works.',
    'Only static-site components; lowest strategy satisfies the spec.',
  ),
  'rationale.strategy.serverless': tri(
    'Parts of it need a program or data behind the website, so it runs on pay-per-use services.',
    'Something needs a backend, so Hero moved up from static hosting to serverless, the next simplest option.',
    'A backend capability moved the plan above static: serverless is the lowest strategy that satisfies it.',
  ),
  'rationale.strategy.needs-container': tri(
    'This application needs something that has to run all the time, which Hero cannot do yet.',
    'This application needs a program that runs continuously or a database engine. That needs containers, which come in a later version.',
    'Capabilities require strategy=container; not implemented in this version.',
  ),
  'rationale.frontend.static-site': tri(
    'Your website will be stored and served worldwide.',
    'The website is built once and served from a global delivery network.',
    'Frontend as S3 + CloudFront.',
  ),
  'rationale.service.http.serverless': tri(
    'Your program will start only when someone visits.',
    'The web service runs as a function behind an HTTP API, so you pay only when it is used.',
    'HTTP service as API Gateway HTTP API + Lambda (arm64).',
  ),
  'rationale.service.scheduled.serverless': tri(
    'Your scheduled work will run at the right times.',
    'The scheduled job runs as a function started by a scheduler.',
    'Scheduled job as EventBridge Scheduler + Lambda.',
  ),
  'rationale.data.key-value.on-demand': tri(
    'Your data lives in a simple store that grows with you.',
    'Key-value data goes to DynamoDB with on-demand billing, so there is no capacity to manage.',
    'DynamoDB on-demand table.',
  ),
  'rationale.storage.object.private': tri(
    'Your files are kept private.',
    'Files go to a private bucket that is not reachable from the internet.',
    'S3 bucket with Block Public Access.',
  ),
  'rationale.auth.user-pool': tri(
    'People will be able to sign in.',
    'User sign-in is provided by a Cognito user pool.',
    'Cognito user pool and app client.',
  ),
  'rationale.guardrail.budget': tri(
    'You will get an email if spending grows.',
    'A budget alert emails you when spending reaches 80% of the monthly limit.',
    'AWS Budget: monthly limit with alert at 80%.',
  ),
  'rationale.input.secret': tri(
    '{name} is a secret, kept encrypted.',
    '{name} looks like a secret and will be stored encrypted.',
    'Input {name}: secret (SSM SecureString).',
  ),
  'rationale.input.config': tri(
    '{name} is a setting.',
    '{name} is a setting the application reads.',
    'Input {name}: config (SSM String).',
  ),
  'rationale.input.budget-email': tri(
    'The email address that receives spending alerts.',
    'Where budget alerts are sent. It stays in your AWS account.',
    'Budget notification subscriber.',
  ),

  // ---- rationale: AWS --------------------------------------------------------------------
  'rationale.guardrail.private-by-default': tri(
    'Private by default.',
    'Nothing is public unless it has to be.',
    'Block Public Access enabled.',
  ),
  'rationale.guardrail.encryption': tri(
    'Encrypted.',
    'Data is encrypted at rest.',
    'Encryption at rest.',
  ),
  'rationale.guardrail.https-only': tri(
    'Secure connections only.',
    'Only HTTPS is accepted, with modern encryption.',
    'HTTPS only, TLS 1.2 or later.',
  ),
  'rationale.guardrail.least-privilege': tri(
    'Your program gets only the permissions it needs.',
    'The role allows only what this program needs, on this deployment only.',
    'IAM least privilege with a permissions boundary.',
  ),
  'rationale.guardrail.log-retention': tri(
    'Logs are kept for 30 days, then deleted.',
    'Logs are kept for 30 days so they do not grow without limit.',
    'Log retention 30 days.',
  ),
  'rationale.guardrail.backups': tri(
    'Your data is backed up.',
    'Point-in-time backups let you restore data from the last 35 days.',
    'DynamoDB PITR enabled; deletion protection on.',
  ),
  'rationale.guardrail.versioning': tri(
    'Old versions of files are kept.',
    'Versioning keeps earlier versions so an overwrite can be undone.',
    'S3 versioning enabled.',
  ),
  'rationale.guardrail.secret-store': tri(
    'Secrets are kept in a secure place.',
    'Secrets are stored in the secure parameter store, not in the code.',
    'SSM SecureString.',
  ),
  'rationale.cost.assumption.traffic': tri(
    'From {low} to {high} requests a month.',
    'Traffic is assumed to range from {low} to {high} requests a month.',
    'requests/month: {low}..{high}',
  ),
  'rationale.cost.assumption.function': tri(
    'Programs use {memoryMb} MB of memory.',
    'Functions are assumed to use {memoryMb} MB on {architecture} processors.',
    'Lambda {memoryMb} MB, {architecture}.',
  ),
  'rationale.cost.assumption.free-tier': tri(
    'The free monthly allowances AWS gives are included.',
    "AWS's always-free monthly allowances are subtracted before charging.",
    'Always-free allowances applied (Lambda, DynamoDB, CloudWatch, Cognito, CloudFront).',
  ),
  'rationale.cost.assumption.no-domain': tri(
    'A custom web address is not included.',
    'A custom domain name and its DNS are not included.',
    'Route 53 and domain registration excluded.',
  ),
  'rationale.cost.assumption.region-prices': tri(
    'Prices are for {region}.',
    'Prices for {region}, {source}, published {asOf}.',
    'prices region={region} source={source} asOf={asOf}',
  ),

  // ---- evidence and capabilities added for plans ------------------------------------------
  'evidence.capability': tri('', 'needs {value}', 'capability {value}'),
  'capability.cost-control': tri('a spending alert', 'a budget alert', 'cost-control'),

  // ---- errors and questions added for plans ----------------------------------------------
  'error.plan.invalid-answer': tri(
    'One of the answers you gave is not valid.',
    'The answer for "{question}" is not valid, or there is no such question.',
    'Invalid answer for {question}.',
  ),
  'error.plan.no-provider': tri(
    'Hero has no cloud to plan for.',
    'No cloud provider is configured.',
    'No CloudProvider port was supplied.',
  ),
  'question.data.keys-unknown': tri(
    'Hero needs to know how your data is organized before it can create the place to keep it.',
    'A table must be created with a key, and the code does not show which one. Say how items are addressed, for example "id" or "pk:string,sk:string".',
    'No KeySchema, schema definition, or Key usage found for table {table}. Answer name[:type][,name[:type]].',
  ),
  'question.data.keys-confirm': tri(
    'Hero guessed how your data is organized. Please check that it is right.',
    'The code reads items by "{partition}", so Hero will create the table with that key. A table\'s key cannot be changed later, so confirm it.',
    'Key inferred from usage for table {table}: partition {partition}. Confirm or answer name[:type][,name[:type]].',
  ),
  'evidence.source.key-schema': tri('', 'the code declares the table key', 'source key-schema'),
  'evidence.source.schema-definition': tri(
    '',
    'the data model declares the key',
    'source schema-definition',
  ),
  'evidence.source.key-usage': tri('', 'the code reads items by that key', 'source key-usage'),
  'question.scheduled.schedule-unknown': tri(
    'Hero could not tell how often your scheduled work should run.',
    'The schedule for the scheduled job could not be read from the code. Say when it should run, in cron form such as "0 * * * *".',
    'No literal five-field cron expression found for the scheduled service.',
  ),
};
