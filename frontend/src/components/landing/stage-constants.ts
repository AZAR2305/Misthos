/** Stage positions shared by the stage (three.js) and its controls (React), kept apart so the controls do not pull in three. */
export const HOME = { supplier: -2.05, buyer: 2.05 } as const;
/** Where each agent stands to meet the other. */
export const MEET = { supplier: -1.02, buyer: 1.02 } as const;
