/** Stage positions shared by the stage (three.js) and its controls (React), kept apart so the controls do not pull in three. */
export const HOME = { supplier: -3.5, buyer: 3.5 } as const;
/** Where each agent stands to meet the other. */
export const MEET = { supplier: -1.6, buyer: 1.6 } as const;
