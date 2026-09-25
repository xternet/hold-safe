import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ClmmInstrument, PoolInfoLayout, getPdaExBitmapAccount } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { DEX, POOL, type RouteCase, type Snapshot } from "../../_shared/mod";
import type { makeAccounts } from "../_1_accounts/mod";

export function makeSwap(snapshot: Snapshot, accounts: ReturnType<typeof makeAccounts>, testCase: RouteCase) {
  const captured = snapshot.accounts.find((account) => account.address === POOL);
  if (captured === undefined || captured.owner !== DEX) throw new Error("Missing verified CLMM pool");
  const pool = PoolInfoLayout.decode(Buffer.from(captured.data, "base64"));
  const authority = testCase.mode === "owner" ? accounts.owner.publicKey
    : testCase.mode === "delegate" ? accounts.delegate.publicKey : accounts.pda;
  const source = testCase.mode === "pda" ? accounts.staging : accounts.source;
  const floor = testCase.floor === undefined ? 1n : testCase.floor;
  const swap = ClmmInstrument.swapV2Instruction(new PublicKey(DEX), authority,
    new PublicKey(POOL), pool.configId, source, accounts.output, pool.vaultA, pool.vaultB,
    pool.mintA, pool.mintB, snapshot.ticks.map((key) => new PublicKey(key)), pool.observationId,
    new BN(accounts.amount.toString()), new BN(floor.toString()), new BN(0), true,
    getPdaExBitmapAccount(new PublicKey(DEX), new PublicKey(POOL)).publicKey);
  if (testCase.mode !== "pda") return swap;
  return new TransactionInstruction({ programId: accounts.probe, data: swap.data,
    keys: [{ pubkey: accounts.source, isSigner: false, isWritable: true },
      ...swap.keys.map((key) => ({ ...key, isSigner: false })),
      { pubkey: new PublicKey(DEX), isSigner: false, isWritable: false }] });
}
