import { test, expect } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { address, lamports } from "@solana/kit";
import { LiteSVM } from "litesvm";
import { buildDemoMint } from "../../src/_adapters/_0_solana/_7_demo/_0_assets/mod";
import { send, readToken } from "../_2_swap/_1_fixture/_1_accounts/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";
import { createFreezeAccountInstruction, createThawAccountInstruction, createPauseInstruction, createResumeInstruction } from "@solana/spl-token";

test("demo assets mint actual test balances with reversible freeze/pause authority", () => {
  const svm = new LiteSVM(), operator = Keypair.generate();
  const funding = svm.airdrop(address(operator.publicKey.toBase58()), lamports(2_000_000_000n));
  if (funding === null) throw new Error("Missing SVM funding result");
  assertSuccess(funding);
  for (const [kind, pausable] of [["demoAAPL", false], ["demoAAPL", true], ["demoUSD", false]] as const) {
    const mint = Keypair.generate(), setup = buildDemoMint(kind, operator.publicKey, mint.publicKey, 10_000_000, pausable);
    assertSuccess(send(svm, setup.instructions, operator, [mint]));
    expect(readToken(svm, setup.account).amount).toBe(setup.supply);
    if (kind === "demoAAPL") {
      assertSuccess(send(svm, [createFreezeAccountInstruction(setup.account, mint.publicKey, operator.publicKey, [], setup.program)], operator));
      const frozen = svm.getAccount(address(setup.account.toBase58()));
      if (!frozen.exists) throw new Error("Missing frozen demo account");
      expect(frozen.data[108]).toBe(2);
      assertSuccess(send(svm, [createThawAccountInstruction(setup.account, mint.publicKey, operator.publicKey, [], setup.program)], operator));
      const thawed = svm.getAccount(address(setup.account.toBase58()));
      if (!thawed.exists) throw new Error("Missing thawed demo account");
      expect(thawed.data[108]).toBe(1);
      if (pausable) {
      assertSuccess(send(svm, [createPauseInstruction(mint.publicKey, operator.publicKey, [], setup.program)], operator));
      assertSuccess(send(svm, [createResumeInstruction(mint.publicKey, operator.publicKey, [], setup.program)], operator));
      }
    }
  }
});
