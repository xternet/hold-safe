import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { createMintToInstruction, createFreezeAccountInstruction, createThawAccountInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PoolInfoLayout, TickArrayBitmapExtensionLayout, TickArrayBitmapUtil, getPdaExBitmapAccount, ClmmInstrument, TickUtil } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";
import type { DemoMarket } from "../_0_market/mod";

/** Only the server-owned Devnet fixture can be mutated by these controls. */
export class DemoActions {
  constructor(readonly market: DemoMarket) {}
  async scenario(kind: "collapse" | "mint" | "freeze") {
    const { chain } = this.market, { env, operator } = chain;
    const mint = new PublicKey(env.assets[0]!.mint), source = new PublicKey(env.judge.source);
    if (kind === "collapse") return this.trade(false);
    if (kind === "mint") {
      const balances = await this.market.balances();
      // Deliberately increase actual supply by 20%; ordinary issuance is not inherently a hack.
      const amount = BigInt(balances.supply) / 5n;
      if (amount > 1000000000000000n) throw new Error("Demo supply safety cap reached");
      return chain.send("mint-anomaly", [createMintToInstruction(mint, new PublicKey(env.assets[0]!.account), operator.publicKey, amount, [], TOKEN_2022_PROGRAM_ID)]);
    }
    return chain.send("freeze", [createFreezeAccountInstruction(source, mint, operator.publicKey, [], TOKEN_2022_PROGRAM_ID)]);
  }
  async restore() {
    const { chain } = this.market, { env, operator } = chain;
    let balances = await this.market.balances();
    if (balances.frozen) await chain.send("thaw", [createThawAccountInstruction(new PublicKey(env.judge.source), new PublicKey(env.assets[0]!.mint), operator.publicKey, [], TOKEN_2022_PROGRAM_ID)]);
    await this.trade(true);
    balances = await this.market.balances();
    const topUp = 1000000000n - BigInt(balances.stockRaw);
    if (topUp > 0n) await chain.send("refill", [createMintToInstruction(new PublicKey(env.assets[0]!.mint), new PublicKey(env.judge.source), operator.publicKey, topUp, [], TOKEN_2022_PROGRAM_ID)]);
  }
  async thaw() {
    const {chain}=this.market,{env,operator}=chain;
    if(!(await this.market.balances()).frozen)throw new Error("Demo account is not frozen");
    return chain.send("thaw",[createThawAccountInstruction(new PublicKey(env.judge.source),new PublicKey(env.assets[0]!.mint),operator.publicKey,[],TOKEN_2022_PROGRAM_ID)]);
  }
  private async trade(reset: boolean) {
    const { chain } = this.market, { env, rpc, operator } = chain;
    await chain.verify();
    const dex = new PublicKey(env.pool.dex), poolKey = new PublicKey(env.pool.address);
    const bitmapKey = getPdaExBitmapAccount(dex, poolKey).publicKey;
    const values = await rpc.getMultipleAccountsInfo([poolKey, bitmapKey]);
    if (!values[0]?.owner.equals(dex) || !values[1]?.owner.equals(dex)) throw new Error("Fixture pool unavailable");
    const pool = PoolInfoLayout.decode(values[0].data), bitmap = TickArrayBitmapExtensionLayout.decode(values[1].data);
    if (pool.mintA.toBase58() !== env.assets[0]!.mint || pool.mintB.toBase58() !== env.assets[1]!.mint) throw new Error("Fixture pool mint mismatch");
    const target = TickUtil.priceToSqrtPriceX64(new Decimal(250), 8, 6);
    if (reset && pool.sqrtPriceX64.eq(target)) return null;
    const sell = !reset || pool.sqrtPriceX64.gt(target);
    const ticks = TickArrayBitmapUtil.findTickArrayAddress({ programId:dex, poolId:poolKey, tickSpacing:pool.tickSpacing,
      poolBitmap:pool.tickArrayBitmap, tickArrayBitmap:bitmap, findInfo:{type:sell?"zeroForOne":"oneForZero",count:6,tickArrayCurrent:pool.tickCurrent} });
    if (ticks.length === 0) throw new Error("No fixture liquidity for scenario");
    const stock = new PublicKey(env.assets[0]!.account), usd = new PublicKey(env.assets[1]!.account);
    // Reset uses a price limit, so only the input needed to restore 250 is spent.
    const amount = reset ? (sell ? "10000000000" : "60000000000") : "2000000000";
    const instruction = ClmmInstrument.swapV2Instruction(dex, operator.publicKey, poolKey, pool.configId,
      sell?stock:usd, sell?usd:stock, sell?pool.vaultA:pool.vaultB, sell?pool.vaultB:pool.vaultA,
      sell?pool.mintA:pool.mintB, sell?pool.mintB:pool.mintA, ticks, pool.observationId,
      new BN(amount), new BN(1), reset?target:new BN(0), true, bitmapKey);
    return chain.send(reset?"restore-price":"price-collapse", [ComputeBudgetProgram.setComputeUnitLimit({units:600000}), instruction]);
  }
}
