import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMintLen,
  createInitializeMint2Instruction, createInitializeScaledUiAmountConfigInstruction,
  createInitializePausableConfigInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export type DemoAsset = "demoAAPL" | "demoUSD";
export function demoMintSpace(kind: DemoAsset, pausable = false): number {
  return getMintLen(kind === "demoAAPL" ? [ExtensionType.ScaledUiAmountConfig, ...(pausable ? [ExtensionType.PausableConfig] : [])] : []);
}
/** Fixture authority only: caller must enforce Devnet genesis before any send. */
export function buildDemoMint(kind: DemoAsset, operator: PublicKey, mint: PublicKey, rent: number, pausable = false) {
  if (!Number.isSafeInteger(rent) || rent <= 0) throw new Error("Invalid demo mint rent");
  const stock = kind === "demoAAPL", program = stock ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const decimals = stock ? 8 : 6, supply = stock ? 100_000_000_000n : 1_000_000_000_000n;
  const account = getAssociatedTokenAddressSync(mint, operator, false, program);
  const instructions = [SystemProgram.createAccount({ fromPubkey: operator, newAccountPubkey: mint,
    space: demoMintSpace(kind, pausable), lamports: rent, programId: program })];
  if (stock) instructions.push(createInitializeScaledUiAmountConfigInstruction(mint, operator, 1, program));
  if (stock && pausable) instructions.push(createInitializePausableConfigInstruction(mint, operator, program));
  instructions.push(createInitializeMint2Instruction(mint, decimals, operator, operator, program),
    createAssociatedTokenAccountIdempotentInstruction(operator, account, operator, mint, program),
    createMintToCheckedInstruction(mint, account, operator, supply, decimals, [], program));
  return { instructions, account, program, decimals, supply };
}
