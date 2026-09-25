import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createApproveCheckedInstruction, createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { INPUT_MINT, OUTPUT_MINT, PROBE_SEED, type RouteCase } from "../../_shared/mod";

export function send(svm: LiteSVM, instructions: TransactionInstruction[], payer: Keypair, signers: Keypair[] = []) {
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() });
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...instructions);
  transaction.sign(payer, ...signers);
  return svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
}

export function readToken(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(address(key.toBase58()));
  if (!account.exists) throw new Error(`Missing local token fixture ${key}`);
  const data = Buffer.from(account.data);
  return { amount: data.readBigUInt64LE(64), allowance: data.readBigUInt64LE(121) };
}

export function makeAccounts(svm: LiteSVM, testCase: RouteCase) {
  // Public deterministic LOCAL test keys; never loaded by application code.
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(1));
  const keeper = Keypair.fromSeed(new Uint8Array(32).fill(2));
  const delegate = Keypair.fromSeed(new Uint8Array(32).fill(3));
  const probe = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
  const pda = PublicKey.findProgramAddressSync([Buffer.from(PROBE_SEED)], probe)[0];
  const amount = 1_000_000n; // 0.01 raw AAPLx units: local feasibility input only.
  const allowance = testCase.allowance === undefined ? amount : testCase.allowance;
  for (const signer of [owner, keeper, delegate]) {
    const funded = svm.airdrop(address(signer.publicKey.toBase58()), lamports(2_000_000_000n));
    if (funded instanceof FailedTransactionMetadata) throw new Error(funded.meta().logs().join("\n"));
  }
  const inputMint = new PublicKey(INPUT_MINT);
  const outputMint = new PublicKey(OUTPUT_MINT);
  const source = getAssociatedTokenAddressSync(inputMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const staging = getAssociatedTokenAddressSync(inputMint, pda, true, TOKEN_2022_PROGRAM_ID);
  const output = getAssociatedTokenAddressSync(outputMint, owner.publicKey, false, TOKEN_PROGRAM_ID);
  const setup = send(svm, [
    createAssociatedTokenAccountInstruction(owner.publicKey, source, owner.publicKey, inputMint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(owner.publicKey, staging, pda, inputMint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(owner.publicKey, output, owner.publicKey, outputMint, TOKEN_PROGRAM_ID),
  ], owner);
  if (setup instanceof FailedTransactionMetadata) throw new Error(`Fixture ATA setup failed:\n${setup.meta().logs().join("\n")}`);
  const account = svm.getAccount(address(source.toBase58()));
  if (!account.exists) throw new Error("Fixture source ATA missing after creation");
  const data = Buffer.from(account.data);
  // Local balance fixture, not a mainnet transfer or mint-authority impersonation.
  data.writeBigUInt64LE(amount * 10n, 64);
  svm.setAccount({ ...account, data });
  if (testCase.mode !== "owner") {
    const target = testCase.mode === "pda" ? pda : delegate.publicKey;
    const approval = send(svm, [createApproveCheckedInstruction(source, inputMint, target,
      owner.publicKey, allowance, 8, [], TOKEN_2022_PROGRAM_ID)], owner);
    if (approval instanceof FailedTransactionMetadata) throw new Error(`Fixture approval failed:\n${approval.meta().logs().join("\n")}`);
  }
  return { owner, keeper, delegate, probe, pda, source, staging, output, amount };
}
