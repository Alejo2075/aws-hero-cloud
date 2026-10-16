// Deploys a folder using only the Hero SDK: no CLI, no terminal, no presentation code.
// Any product can embed the engine this way and decide for itself how a person approves.
import { approvalFromChallenge, createHero } from '@hero-cloud/sdk';

/**
 * Analyzes, plans, asks `approve` whether to go ahead, deploys, and returns the result.
 *
 * `approve(plan)` is where your product shows the plan to a person. It must return true only when
 * a person agreed. An AI agent or a script must never answer it on a person's behalf.
 */
export async function deployFolder(hero, folder, { approve, budgetEmail, accountId, region }) {
  const analysis = await hero.analyze({ kind: 'directory', location: folder });
  const plan = await hero.plan(analysis, {
    ...(accountId === undefined ? { useIdentity: true } : { accountId }),
    ...(region === undefined ? {} : { region }),
  });

  if (plan.warnings.some((warning) => warning.severity === 'blocking')) {
    return { status: 'blocked', plan };
  }
  if (!(await approve(plan))) return { status: 'declined', plan };

  const challenge = await hero.requestApproval(plan);
  const approval = approvalFromChallenge(challenge, 'headless-example');
  const result = await hero.deploy(plan, approval, {
    inputs: budgetEmail === undefined ? {} : { BUDGET_ALERT_EMAIL: budgetEmail },
  });
  return { status: result.status, plan, result };
}

// Run it: `node examples/headless/deploy.mjs ./my-app me@example.com`
// (needs AWS credentials for your own account; it asks nothing and approves nothing by itself).
if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const [folder, email] = process.argv.slice(2);
  if (folder === undefined) {
    console.error('usage: node deploy.mjs <folder> [budget-email]');
    process.exitCode = 2;
  } else {
    const hero = createHero({ assemblyDirectory: '.hero/assemblies' });
    const outcome = await deployFolder(hero, folder, {
      budgetEmail: email,
      // A real product asks a person here. This example only shows the plan's cost and stops.
      approve: (plan) => {
        console.log(`Plan ${plan.id}: ${plan.changes.length} changes, digest ${plan.digest}`);
        return false;
      },
    });
    console.log(outcome.status);
  }
}
