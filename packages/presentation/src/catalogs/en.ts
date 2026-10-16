import type { MessageCatalog } from '../types.js';
import { enPlan } from './en-plan.js';
import { enResult } from './en-result.js';

const tri = (simple: string, guided: string, expert: string) => ({ simple, guided, expert });

export const en: MessageCatalog = {
  locale: 'en',
  messages: {
    ...enPlan,
    ...enResult,
    // ---- view labels -----------------------------------------------------------------------
    'view.analysis.title': 'What Hero understood about {name}',
    'view.section.summary': 'Summary',
    'view.section.components': 'What your application is made of',
    'view.section.questions': 'Questions for you',
    'view.section.leftout': 'Left out for your safety',
    'view.section.detections': 'What Hero detected',
    'view.section.spec': 'Hero Spec',
    'view.section.skipped': 'Skipped files',
    'view.section.details': 'Details',
    'view.analysis.nothing': tri(
      'Hero could not tell what this application is yet. It needs a little help from you.',
      'Hero did not recognize a website, a service, or a database in this project, so it will not guess a plan.',
      'No frontend, service, data, or storage capability was detected. Nothing will be planned until the open questions are answered.',
    ),
    'view.analysis.summary': tri(
      'Your application, {name}, looks like this:',
      '{name} is made of the parts below. Each one says why Hero thinks so.',
      '{name}: components in the Hero Spec: {count}.',
    ),
    'view.questions.intro': tri(
      'Questions Hero needs you to answer before it can go on: {count}.',
      'These questions could not be answered from the code alone. Your answers decide the plan.',
      'Open questions: {count}. Answer them through `PlanOptions.answers`, keyed by id.',
    ),
    'view.leftout.count': tri(
      'Files ignored because they look like passwords or keys: {count}. Hero never reads them.',
      'Files left out of the analysis because they look like secrets: {count}. They are never read, uploaded, or sent to an AI.',
      'Entries skipped by the source loader: {count}.',
    ),
    'view.analysis.ai': tri('', '', 'An AI helped with this analysis.'),

    // ---- table headers and small labels ---------------------------------------------------
    'column.capability': 'Capability',
    'column.confidence': 'Confidence',
    'column.evidence': 'Evidence',
    'column.id': 'Id',
    'column.code': 'Code',
    'column.details': 'Details',
    'column.options': 'Options',
    'column.path': 'Path',
    'column.reason': 'Reason',
    'meta.source-hash': 'Source hash',
    'meta.ai-assisted': 'AI assisted',
    'meta.yes': 'yes',
    'meta.no': 'no',
    'confidence.high': 'very sure',
    'confidence.medium': 'fairly sure',
    'confidence.low': 'not very sure',
    'skipped.sensitive': 'looks like a secret',
    'skipped.symlink': 'symbolic link (never followed)',
    'skipped.ignored': 'dependencies or build output',
    'skipped.special': 'not a regular file',

    // ---- components ------------------------------------------------------------------------
    'component.frontend': tri(
      'A website',
      'A website built with {framework}',
      'frontend framework={framework}',
    ),
    'component.service.http': tri(
      'A program that answers requests from the internet',
      'A web service ({id}) running {runtime}',
      'service {id}: http, runtime={runtime}',
    ),
    'component.service.scheduled': tri(
      'A program that runs on a schedule',
      'A scheduled job ({id}) running {runtime}',
      'service {id}: scheduled, runtime={runtime}',
    ),
    'component.service.worker': tri(
      'A program that works in the background',
      'A background worker ({id}) running {runtime}',
      'service {id}: worker, runtime={runtime}',
    ),
    'component.service.process': tri(
      'A program that runs on its own',
      'A long-running program ({id}) running {runtime}',
      'service {id}: process, runtime={runtime}',
    ),
    'component.data.relational': tri(
      'A database',
      'A relational database ({engine})',
      'data {id}: relational, engine={engine}',
    ),
    'component.data.key-value': tri(
      'A simple data store',
      'A key-value data store',
      'data {id}: key-value',
    ),
    'component.data.document': tri(
      'A database',
      'A document database ({engine})',
      'data {id}: document, engine={engine}',
    ),
    'component.data.cache': tri(
      'A fast memory store',
      'A cache ({engine})',
      'data {id}: cache, engine={engine}',
    ),
    'component.data.search': tri('A search engine', 'A search engine', 'data {id}: search'),
    'component.storage.object': tri(
      'Storage for files',
      'Object storage for files',
      'storage {id}: object',
    ),
    'component.storage.file-system': tri(
      'A folder on disk that must be kept',
      'Files kept on a disk that must survive restarts',
      'storage {id}: file-system',
    ),
    'component.auth': tri('Users signing in', 'Users sign in', 'auth.required=true'),
    'component.environment': tri(
      'Settings you will need to provide: {count}',
      'Settings the application reads (names only): {names}',
      'environment: {names}',
    ),

    // ---- capabilities ----------------------------------------------------------------------
    'capability.web-frontend': tri('a website', 'a website or web page', 'web-frontend'),
    'capability.http-service': tri(
      'a program that answers requests',
      'an HTTP service',
      'http-service',
    ),
    'capability.scheduled-job': tri(
      'a program that runs on a schedule',
      'a scheduled job',
      'scheduled-job',
    ),
    'capability.process-service': tri(
      'a program that runs on its own',
      'a long-running process',
      'process-service',
    ),
    'capability.relational-data': tri('a database', 'a relational database', 'relational-data'),
    'capability.key-value-data': tri('a simple data store', 'a key-value store', 'key-value-data'),
    'capability.document-data': tri('a database', 'a document database', 'document-data'),
    'capability.cache': tri('a fast memory store', 'a cache', 'cache'),
    'capability.search': tri('a search engine', 'a search engine', 'search'),
    'capability.object-storage': tri('storage for files', 'object storage', 'object-storage'),
    'capability.file-uploads': tri('people uploading files', 'file uploads', 'file-uploads'),
    'capability.file-system-write': tri(
      'saving files on disk',
      'writes to the local disk',
      'file-system-write',
    ),
    'capability.authentication': tri('people signing in', 'user authentication', 'authentication'),
    'capability.environment-variables': tri(
      'settings',
      'environment variables',
      'environment-variables',
    ),
    'capability.node-runtime': tri('JavaScript', 'the Node.js runtime', 'node-runtime'),
    'capability.monorepo': tri(
      'several projects in one',
      'a monorepo with several packages',
      'monorepo',
    ),
    'capability.declared-spec': tri(
      'a settings file',
      'a hero.yaml file (not trusted)',
      'declared-spec',
    ),

    // ---- evidence --------------------------------------------------------------------------
    'evidence.dependency': tri('', 'uses the {value} library', 'dependency {value}'),
    'evidence.file': tri('', 'has the file {value}', 'file {value}'),
    'evidence.script': tri('', 'has a "{value}" script', 'script {value}'),
    'evidence.field': tri('', 'sets {value}', 'field {value}'),
    'evidence.config': tri('', 'is configured with {value}', 'config {value}'),
    'evidence.source': tri('', 'the code shows {value}', 'source {value}'),
    'evidence.absent': tri('', 'there is no {value}', 'absent {value}'),
    'evidence.default': tri('', 'defaults to {value}', 'default {value}'),
    'evidence.source.listen-port': tri('', 'the code opens a network port', 'source listen-port'),
    'evidence.source.health-route': tri(
      '',
      'the code has a health-check address',
      'source health-route',
    ),
    'evidence.config.output=export': tri(
      '',
      'is set to export a static site',
      'config output=export',
    ),
    'evidence.config.server-rendering': tri(
      '',
      'renders pages on a server',
      'config server-rendering',
    ),
    'evidence.absent.package.json': tri(
      '',
      'there is no package.json, so it is plain HTML',
      'absent package.json',
    ),
    'evidence.unknown': tri('', '{value}', '{value}'),

    // ---- questions -------------------------------------------------------------------------
    'question.detector.failed': tri(
      'Hero could not check one part of your project.',
      "One of Hero's checks ({detector}) did not finish, so that part was skipped.",
      'Detector {detector} failed or timed out; its findings are missing.',
    ),
    'question.merge.conflict': tri(
      'Hero found two different answers about the same thing and picked the more likely one. Please check it.',
      'Two checks disagreed about the {kind} "{id}". Hero kept the more confident one; please confirm it.',
      'Conflicting {kind} contribution for id {id}; the highest confidence won.',
    ),
    'question.repository-spec.invalid': tri(
      'Your project has a settings file Hero could not read. It was ignored.',
      'The {file} in your project is not valid, so it was ignored.',
      '{file} failed Hero Spec validation and was not applied.',
    ),
    'question.repository-spec.unverified': tri(
      "Your project's settings file says something Hero could not confirm. It was ignored for safety.",
      'The {file} in your project declares "{field}", but Hero could not confirm it from the code, so it was not used.',
      '{file} declares {field}; analysis did not confirm it. Supply the spec from outside the source to use it.',
    ),
    'question.frontend.build-missing': tri(
      'Hero could not find how to build your website.',
      'The project has no "build" script, so Hero does not know how to prepare the website.',
      'Frontend detected but package.json has no scripts.build.',
    ),
    'question.service.start-unknown': tri(
      'Hero could not find how to start your program.',
      'The project has no "start" script and no clear starting file for the service "{service}".',
      'No scripts.start, main, or conventional entry file for service {service}.',
    ),
    'question.service.port-unknown': tri(
      'Hero could not tell which door your program listens on.',
      'Hero could not find the network port the service "{service}" uses.',
      'No listen() call or PORT default found for service {service}.',
    ),
    'question.scheduled.inside-server': tri(
      'Your program does scheduled work and also answers requests. Should they run separately?',
      'A scheduler runs inside your web server. Running them separately is usually safer, but it is your decision.',
      'A cron library and a server framework are both present; the job cannot be split automatically.',
    ),
    'question.data.sqlite-persistence': tri(
      'Your app keeps its data in a file. Must that data survive restarts?',
      'SQLite stores data in a file on disk. If it must survive restarts and updates, it needs durable storage.',
      'SQLite detected: confirm whether the database file needs persistent storage.',
    ),
    'question.data.engine-unknown': tri(
      'Your app uses a database, but Hero could not tell which kind.',
      'The {library} library works with several database engines and the project does not say which one.',
      'ORM {library} detected without a recognizable engine.',
    ),
    'question.storage.uploads': tri(
      'People can upload files. Where should they be kept?',
      'The app accepts uploads. Choose whether they go to object storage or stay on a disk.',
      'Upload library present with no storage destination detected.',
    ),
    'question.storage.writes-to-disk': tri(
      'Your program saves files on its own disk. Must they be kept?',
      'The code writes files locally. If they must survive restarts, they need durable storage.',
      'Local file writes found and no object storage detected.',
    ),
    'question.monorepo.choose-package': tri(
      'Your project holds several apps. Which one should Hero put online?',
      'This repository contains several packages. Choose the one to deploy.',
      'Workspace with multiple packages and no deployable root. Re-run with `root`.',
    ),
    'question.app.not-recognized': tri(
      'Hero does not recognize this kind of application yet, so it will not guess.',
      'This project does not match any framework Hero knows. You can describe it yourself or share it so support can be added.',
      'No known framework or capability matched. See the unsupported-application report.',
    ),

    // ---- errors ----------------------------------------------------------------------------
    'error.approval.digest-mismatch': tri(
      'The plan changed after you approved it, so nothing was done.',
      'The approval does not match this plan. Review it and approve again.',
      'approval.planDigest differs from the stored plan digest.',
    ),
    'error.approval.account-mismatch': tri(
      'This approval was for a different AWS account, so nothing was done.',
      'The approval was made for another AWS account.',
      'approval.accountId differs from plan.target.accountId.',
    ),
    'error.approval.region-mismatch': tri(
      'This approval was for a different region, so nothing was done.',
      'The approval was made for another AWS region.',
      'approval.region differs from plan.target.region.',
    ),
    'error.approval.expired': tri(
      'The approval is too old. Please approve again.',
      'Approvals expire after a short time. Review the plan and approve again.',
      'Challenge or approval past expiresAt.',
    ),
    'error.approval.unknown-challenge': tri(
      'Hero does not recognize this approval. Please approve again.',
      'The approval was already used or was never issued by this engine.',
      'Nonce not found: single-use challenge already consumed or forged.',
    ),
    'error.approval.plan-mismatch': tri(
      'This approval is for a different plan, so nothing was done.',
      'The approval belongs to another plan.',
      'approval.planId differs from plan.id.',
    ),
    'error.plan.unknown': tri(
      'Hero does not know this plan.',
      'This plan was not produced by this engine, so it cannot be approved.',
      'plan id not found in PlanStore.',
    ),
    'error.plan.tampered': tri(
      'This plan was changed, so Hero will not use it.',
      'The plan no longer matches its seal. Create it again.',
      'isSealIntact(plan) is false or digest differs from the reference.',
    ),
    'error.plan.blocking-warning': tri(
      'Something must be fixed before this can go online.',
      'The plan has a blocking warning. Resolve it first.',
      'plan contains a warning with severity=blocking.',
    ),
    'error.plan.missing-input': tri(
      'Hero needs a few more details before it can go on.',
      'Some required inputs have not been provided.',
      'requiredInputs not satisfied.',
    ),
    'error.identity.root-refused': tri(
      'You are signed in to AWS as the account owner. For your safety Hero will not use that.',
      'Hero refuses root credentials. Sign in as a limited user or role instead.',
      'sts:GetCallerIdentity returned the root principal.',
    ),
    'error.identity.unknown': tri(
      'Hero could not tell who you are on AWS.',
      'The AWS credentials could not be verified.',
      'sts:GetCallerIdentity failed.',
    ),
    'error.source.not-found': tri(
      'Hero could not find or open that.',
      'The folder, file, or repository could not be found or opened.',
      'Source location missing, unreadable, or not the expected kind.',
    ),
    'error.source.too-large': tri(
      'That project is too big for Hero to read safely.',
      'The project exceeds the size limit.',
      'A file, the total size, or the compression ratio exceeded a limit.',
    ),
    'error.source.too-many-files': tri(
      'That project has too many files for Hero to read safely.',
      'The project exceeds the file-count limit.',
      'maxFiles exceeded.',
    ),
    'error.source.unsafe-path': tri(
      'That project contains something unsafe, so Hero stopped.',
      'A file path in the project tries to escape its folder, or a file changed while it was being read.',
      'Path traversal, absolute path, symlink, collision, or hash mismatch.',
    ),
    'error.source.unsupported': tri(
      'Hero cannot use that kind of source.',
      'This kind of source, address, or archive is not supported.',
      'Unsupported scheme, host, archive feature, or git version.',
    ),
    'error.source.timeout': tri(
      'That took too long, so Hero stopped.',
      'The operation exceeded its time limit.',
      'Timeout while loading or analyzing.',
    ),
    'error.spec.invalid': tri(
      'The description of the application is not valid.',
      'The Hero Spec failed validation.',
      'Hero Spec validation failed: {issues}',
    ),
    'error.provider.unavailable': tri(
      'Hero cannot reach AWS right now.',
      'The cloud provider could not be reached.',
      'Provider call failed.',
    ),
    'error.deployment.failed': tri(
      'The deployment did not work. Your files were not lost.',
      'The deployment failed. Check the details and try again.',
      'Deployment failed; see events for the stack.',
    ),
    'error.deployment.locked': tri(
      'Another deployment of this app is already running.',
      'A deployment lock is held for this project.',
      'Deployment lock held by another process.',
    ),
    'error.internal.unexpected': tri(
      'Something went wrong inside Hero.',
      'An unexpected error occurred. It is not your fault.',
      'Unexpected internal error. Re-run with HERO_DEBUG=1.',
    ),
    'error.internal.not-implemented': tri(
      'That part of Hero is not ready yet.',
      'This operation is not available in this version.',
      'Operation {operation} is not implemented.',
    ),
    // ---- command line ------------------------------------------------------------------------
    'cli.help': `hero-cloud: put any application on your own AWS account

Usage:
  hero-cloud analyze <source> [options]
  hero-cloud plan <source> [options]
  hero-cloud deploy <source> [options]
  hero-cloud health <deployment>
  hero-cloud outputs <deployment>
  hero-cloud destroy <deployment> [options]

<source> is a folder, a .zip file, or an https:// Git repository.
Hero reads it without running anything and tells you what it needs.

Options:
  -l, --level <simple|guided|expert>  How much detail to show (default: simple)
      --locale <tag>                  Language, such as en or es
      --json                          Print machine-readable JSON
      --root <folder>                 Analyze one folder inside the source (monorepos)
      --name <name>                   Name to use if the project has none
      --spec <file>                   Use a Hero Spec you provide instead of analyzing
      --kind <directory|zip|git>      Force the kind of source
      --region <region>               AWS region for the plan (default: us-east-1)
      --account-id <12 digits>        The AWS account the plan is for
      --offline                       Never use the network, not even for public prices
      --answer <question>=<answer>    Answer a question Hero asked (can be repeated)
      --approve <plan digest>         Approve exactly this plan without a prompt (for scripts)
      --budget-email <address>        Where spending alerts are sent
      --profile <name>                Use this AWS profile
      --state-dir <folder>            Where Hero remembers deployments (default: .hero)
      --no-color                      Do not use colors
  -h, --help                          Show this help
  -v, --version                       Show the version

Environment: HERO_LEVEL, HERO_LOCALE, HERO_BUDGET_EMAIL, NO_COLOR, and HERO_DEBUG=1 (shows technical error details).

deploy shows the plan and creates nothing until you approve it. A <deployment> is the name
Hero printed, such as hero-my-app. Exit codes: 0 ok, 1 failed, 2 wrong command, 3 plan blocked,
4 deployed but the checks did not show it working.`,
    'cli.prompt.approve': 'Approve this plan and apply it to your AWS account? [y/N]',
    'cli.prompt.budget-email':
      'Email address for spending alerts (stored only in your AWS account):',
    'cli.declined': 'Not approved. Nothing was changed.',
    'cli.progress.deploy': 'Setting things up on AWS...',
    'cli.progress.verify': 'Checking that it works...',
    'cli.progress.destroy': 'Removing from AWS...',
    'cli.hint.answer':
      'To answer a question, run the command again with --answer <question>=<answer>. Questions to answer: {ids}',
    'cli.progress.plan': 'Planning...',
    'cli.usage-hint': 'Run hero-cloud --help to see how to use it.',
    'cli.progress.load': 'Reading your project...',
    'cli.progress.analyze': 'Working out what it needs...',
    'error.usage': tri(
      'Hero did not understand that command.',
      'The command line was not valid ({reason}). Run with --help.',
      'Invalid usage: {reason}',
    ),
    'error.unknown': tri(
      'Something went wrong.',
      'An unexpected error occurred.',
      'Unclassified error.',
    ),
  },
};
