/**
 * An agent's /health says what is wrong with its wallet as "CODE: message hint". The page turns the ones a person can fix into a plain step
 * instead of showing the raw text. Unknown text is shown as it is: nothing is made up.
 */
export interface WalletNotice {
  title: string;
  body: string;
  /** The exact command to run, shown in a code block. */
  command?: string;
}

const COMMAND = /(\$env:CIRCLE_CLI_HOME=.*|pnpm exec circle wallet .*)$/;

export function walletNotice(detail: string): WalletNotice {
  if (detail.startsWith("WALLET_NOT_ACTIVATED")) {
    return {
      title: "Activate your wallet",
      body: "Your agent's wallet is new. Circle wallets need one small transaction before they can sign: send 0.01 USDC from it to any address you control. You only do this once.",
      command: COMMAND.exec(detail)?.[1],
    };
  }
  if (detail.startsWith("SESSION_EXPIRED")) {
    return {
      title: "Log your agent in again",
      body: "Your agent's Circle login has expired, so it will not act until you log in. Run this in a terminal, then type the code Circle emails you.",
      command: COMMAND.exec(detail)?.[1],
    };
  }
  return { title: "Its wallet needs attention", body: detail };
}
