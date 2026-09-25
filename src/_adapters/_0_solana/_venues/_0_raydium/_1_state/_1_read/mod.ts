import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
import { PoolInfoLayout, TickArrayBitmapExtensionLayout, TickArrayBitmapUtil, getPdaExBitmapAccount } from "@raydium-io/raydium-sdk-v2";
import type { Policy } from "../../../../../../_kernel/mod";
import { DEX, DEMO_DEX, DEVNET, MAINNET, nativePolicy } from "../../../../_shared/mod";
import type { NativeBatch } from "../../_shared/mod";
import { DeploymentCheck } from "../_0_deployment/mod";

export class LiveStateReader {
  private networkVerified = false;
  private readonly deployment: DeploymentCheck;
  constructor(private readonly connection: Connection, private readonly now: () => number, private readonly network = MAINNET) {
    if (![MAINNET, DEVNET].includes(network)) throw new Error("Unsupported reader network");
    this.deployment = new DeploymentCheck(connection, network === DEVNET ? DEMO_DEX : DEX);
  }
  async read(policy: Policy): Promise<NativeBatch> {
    const { dex: DEX, network } = nativePolicy(policy);
    if (network !== this.network) throw new Error("Policy reader network mismatch");
    if (!this.networkVerified) {
      if (await this.connection.getGenesisHash() !== this.network) throw new Error("RPC network mismatch");
      this.networkVerified = true;
    }
    const poolKey = new PublicKey(policy.coverage.pool), bitmapKey = getPdaExBitmapAccount(DEX, poolKey).publicKey;
    const preliminary = await this.connection.getMultipleAccountsInfoAndContext([poolKey, bitmapKey], "confirmed");
    const [poolAccount, bitmapAccount] = preliminary.value;
    if (poolAccount === null || poolAccount === undefined || bitmapAccount === null || bitmapAccount === undefined ||
        !poolAccount.owner.equals(DEX) || !bitmapAccount.owner.equals(DEX)) throw new Error("Missing/foreign pool or bitmap");
    const pool = PoolInfoLayout.decode(poolAccount.data), bitmap = TickArrayBitmapExtensionLayout.decode(bitmapAccount.data);
    const zeroForOne = pool.mintA.toBase58() === policy.input.address;
    const ticks = TickArrayBitmapUtil.findTickArrayAddress({ programId: DEX, poolId: poolKey,
      tickSpacing: pool.tickSpacing, poolBitmap: pool.tickArrayBitmap, tickArrayBitmap: bitmap,
      findInfo: { type: zeroForOne ? "zeroForOne" : "oneForZero", count: 6, tickArrayCurrent: pool.tickCurrent } });
    if (ticks.length === 0) throw new Error("No initialized ticks for exit direction");
    const keys = [poolKey, bitmapKey, pool.configId, pool.mintA, pool.mintB, pool.vaultA, pool.vaultB,
      pool.observationId, SYSVAR_CLOCK_PUBKEY, ...ticks];
    if (new Set(keys.map((key) => key.toBase58())).size !== keys.length) throw new Error("Duplicate native route accounts");
    const final = await this.connection.getMultipleAccountsInfoAndContext(keys,
      { commitment: "confirmed", minContextSlot: preliminary.context.slot });
    const accounts = new Map<string, AccountInfo<Buffer>>();
    final.value.forEach((value, index) => {
      const key = keys[index];
      if (value === null || key === undefined) throw new Error(`Native quote account unavailable at index ${index}`);
      accounts.set(key.toBase58(), value);
    });
    await this.deployment.verify(policy.coverage.programVersion, final.context.slot);
    return { slot: final.context.slot, accounts, observedAtMs: this.now(), programVersion: policy.coverage.programVersion };
  }
}
