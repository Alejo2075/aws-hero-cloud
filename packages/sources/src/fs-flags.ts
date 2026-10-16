import { constants } from 'node:fs';

/** `O_NOFOLLOW` does not exist on every platform; where it is missing, callers also use `lstat`. */
const flag = constants.O_NOFOLLOW as number | undefined;
export const NO_FOLLOW: number = flag ?? 0;
