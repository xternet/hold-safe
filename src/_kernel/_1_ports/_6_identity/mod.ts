import type { ChainRef } from "../../_0_types/mod";

export interface WalletIdentityPort {
  readonly chain: ChainRef;
  validOwner(owner: string): boolean;
  verify(owner: string, message: string, signatureBase64: string): Promise<boolean>;
}
