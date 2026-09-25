import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { AccountState, ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getDefaultAccountState,
  getExtensionData, getExtensionTypes, getPausableConfig, getScaledUiAmountConfig, getTransferHook,
  getTransferHookAccount, unpackAccount, unpackMint } from "@solana/spl-token";

export function nativeMint(key: PublicKey, account: AccountInfo<Buffer>, profile: string, decimals: number) {
  const extended = profile === "xstock-scaled-v1";
  if (!extended && profile !== "spl-classic-v1") throw new Error("Unsupported token profile");
  const program = extended ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mint = unpackMint(key, account, program);
  if (!mint.isInitialized || mint.decimals !== decimals) throw new Error("Mint initialization/decimal mismatch");
  const types = getExtensionTypes(mint.tlvData);
  if (!extended && (account.data.length !== 82 || types.length !== 0)) throw new Error("Classic mint has extensions");
  const allowed = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata, ExtensionType.PermanentDelegate,
    ExtensionType.DefaultAccountState, ExtensionType.ScaledUiAmountConfig, ExtensionType.PausableConfig,
    ExtensionType.TransferHook, ExtensionType.ConfidentialTransferMint]);
  if (types.some((type) => !allowed.has(type)) || new Set(types).size !== types.length) throw new Error("Unsupported mint extension");
  const pause = getPausableConfig(mint), hook = getTransferHook(mint), defaults = getDefaultAccountState(mint);
  if (pause !== null && pause.paused) throw new Error("Mint paused");
  if (hook !== null && !hook.programId.equals(PublicKey.default)) throw new Error("Transfer hook enabled");
  if (defaults !== null && defaults.state !== AccountState.Initialized) throw new Error("Frozen default state");
  const confidential = getExtensionData(ExtensionType.ConfidentialTransferMint, mint.tlvData);
  if (confidential !== null && (confidential.length !== 65 || confidential[32] !== 0)) throw new Error("Unsupported confidential mint config");
  const scaled = getScaledUiAmountConfig(mint);
  if (extended && scaled === null) throw new Error("Scaled token profile missing multiplier");
  if (scaled !== null && [scaled.multiplier, scaled.newMultiplier].some((v) => !Number.isFinite(v) || v <= 0)) {
    throw new Error("Invalid scaled multiplier");
  }
  return { mint, program, scaled };
}

export function nativeToken(key: PublicKey, account: AccountInfo<Buffer>, program: PublicKey, mint: PublicKey, owner: PublicKey) {
  const token = unpackAccount(key, account, program);
  if (!token.isInitialized || token.isFrozen || token.isNative || !token.mint.equals(mint) || !token.owner.equals(owner)) {
    throw new Error("Token account state/mint/owner mismatch");
  }
  const allowed = new Set([ExtensionType.ImmutableOwner, ExtensionType.TransferHookAccount, ExtensionType.PausableAccount]);
  const types = getExtensionTypes(token.tlvData);
  if (types.some((type) => !allowed.has(type)) || new Set(types).size !== types.length) throw new Error("Unsupported account extension");
  const hook = getTransferHookAccount(token);
  if (hook !== null && hook.transferring) throw new Error("Account has transient transfer-hook state");
  return token;
}
