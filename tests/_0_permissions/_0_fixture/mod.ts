import { address } from "@solana/kit";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { FailedTransactionMetadata } from "litesvm";
import { loadSnapshot } from "../../_2_swap/_1_fixture/_0_load/mod";
import { makeAccounts, send, readToken } from "../../_2_swap/_1_fixture/_1_accounts/mod";
import { INPUT_MINT } from "../../_2_swap/_shared/mod";
import { GUARD, ORDER, authorize } from "../_shared/mod";

export function fixture() {
  const { svm, snapshot } = loadSnapshot();
  svm.addProgramFromFile(address(GUARD.toBase58()), ".tools/guard/solstock_guard.so");
  const base = makeAccounts(svm, { mode: "owner" });
  const policy = PublicKey.findProgramAddressSync([Buffer.from("policy"), base.owner.publicKey.toBuffer(), ORDER], GUARD)[0];
  const mint = new PublicKey(INPUT_MINT);
  const staging = getAssociatedTokenAddressSync(mint, policy, true, TOKEN_2022_PROGRAM_ID);
  const made = send(svm, [createAssociatedTokenAccountInstruction(base.owner.publicKey, staging,
    policy, mint, TOKEN_2022_PROGRAM_ID)], base.owner);
  assertSuccess(made);
  const a = { ...base, policy, staging };
  const now = svm.getClock().unixTimestamp;
  return { svm, snapshot, a, now,
    arm(options: Parameters<typeof authorize>[3] = {}) {
      return send(svm, [authorize(snapshot, a, now, options)], a.owner);
    },
    run(instruction: TransactionInstruction) { return send(svm, [instruction], a.keeper); },
    balances() { return [a.source, a.staging, a.output].map((k) => readToken(svm, k).amount); },
    state() {
      const p = svm.getAccount(address(policy.toBase58()));
      if (!p.exists) return "absent";
      return p.data[9]; // Anchor discriminator, then version, then state.
    },
  };
}
export function assertSuccess(result: ReturnType<typeof send>): void {
  if (result instanceof FailedTransactionMetadata) throw new Error(result.meta().logs().join("\n"));
}
export function failure(result: ReturnType<typeof send>): string {
  if (!(result instanceof FailedTransactionMetadata)) throw new Error("Expected rejected native transaction");
  return result.meta().logs().join("\n");
}
