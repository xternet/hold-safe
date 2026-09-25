import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// SPL idempotent ATA creation, encoded explicitly because spl-token 0.4.15's
// browser helper references an unimported global Buffer. Native SDK-built
// transactions are the independent byte-for-byte validation reference.
export function associatedAllocation(payer: PublicKey, account: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  return new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: Buffer.from([1]), keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ] });
}
