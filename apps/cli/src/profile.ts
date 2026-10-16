const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ROLE = /^arn:aws[a-z-]*:iam::\d{12}:role\/[A-Za-z0-9+=,.@_-]{1,64}$/;
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;

/** Whether a name is fit to be the name of an AWS profile. */
export const isProfileName = (name: string): boolean => NAME.test(name);

/**
 * The text of a profile that assumes the deployer role through one the person already uses. It is
 * built from checked pieces only, so nothing odd can be smuggled into someone's AWS configuration.
 */
export function deployerProfileText(input: {
  readonly name: string;
  readonly roleArn: string;
  readonly sourceProfile: string;
  readonly region: string;
}): string {
  if (!NAME.test(input.name) || !NAME.test(input.sourceProfile) || !ROLE.test(input.roleArn)) {
    throw new Error('profile pieces are not valid');
  }
  if (!REGION.test(input.region)) throw new Error('profile pieces are not valid');
  return [
    `[profile ${input.name}]`,
    `role_arn = ${input.roleArn}`,
    `source_profile = ${input.sourceProfile}`,
    `region = ${input.region}`,
    '',
  ].join('\n');
}

/** Whether a profile with this name is already in the text of an AWS config file. */
export function hasProfile(configText: string, name: string): boolean {
  return configText.split(/\r?\n/).some((line) => {
    const match = /^\s*\[\s*(?:profile\s+)?([^\]\s]+)\s*\]\s*$/.exec(line);
    return match?.[1] === name;
  });
}
