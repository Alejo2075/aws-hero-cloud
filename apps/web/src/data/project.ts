export const github = 'https://github.com/Alejo2075/aws-hero-cloud';

export const workflow = [
  {
    title: 'Show Hero your app.',
    description:
      'Choose your app’s folder. Hero reads it to understand what it needs, without running it.',
    icon: 'folder',
  },
  {
    title: 'See the plan. You decide.',
    description:
      'Hero explains what it would create and what it could cost. Nothing is created until a person approves.',
    icon: 'plan',
  },
  {
    title: 'Go online. Check the result.',
    description:
      'After approval, Hero puts your app in your AWS account and reports what its checks found, including what they could not verify.',
    icon: 'cloud',
  },
] as const;

export const install = `git clone ${github}.git
cd aws-hero-cloud
pnpm install
pnpm --filter @hero-cloud/cli build`;
