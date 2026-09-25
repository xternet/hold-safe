import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { ClmmConfigLayout, PoolInfoLayout, TickArrayBitmapExtensionLayout, TickArrayLayout,
  TickArrayUtil, getPdaExBitmapAccount, swapInternal } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { corporateActionGate } from "../../../_shared/_11_corporate/mod";
import { type Catalog, type Policy, ratio, validatePolicy } from "../../../../../_kernel/mod";
import { nativeMint, nativePolicy, nativeToken } from "../../../_shared/mod";
import { account, stateHash, type NativeBatch, type NativeQuote } from "../_shared/mod";

export function quoteNativeState(policy: Policy, catalog: Catalog, batch: NativeBatch): NativeQuote {
  validatePolicy(policy, catalog, Math.floor(batch.observedAtMs / 1000)); const { dex: DEX } = nativePolicy(policy);
  if (batch.programVersion !== policy.coverage.programVersion) throw new Error("DEX deployment version changed");
  const poolId = new PublicKey(policy.coverage.pool), poolAccount = account(batch, poolId);
  if (!poolAccount.owner.equals(DEX)) throw new Error("Foreign pool program");
  const pool = PoolInfoLayout.decode(poolAccount.data);
  const zeroForOne = pool.mintA.toBase58() === policy.input.address;
  const [im, om, iv, ov, idec, odec] = zeroForOne
    ? [pool.mintA, pool.mintB, pool.vaultA, pool.vaultB, pool.mintDecimalsA, pool.mintDecimalsB] as const
    : [pool.mintB, pool.mintA, pool.vaultB, pool.vaultA, pool.mintDecimalsB, pool.mintDecimalsA] as const;
  if (im.toBase58() !== policy.input.address || om.toBase58() !== policy.output.address) throw new Error("Pool mint mismatch");
  const inputSpec = catalog.assets.find((a) => a.ref.address === policy.input.address && a.ref.chain.reference === policy.chain.reference);
  const outputSpec = catalog.assets.find((a) => a.ref.address === policy.output.address && a.ref.chain.reference === policy.chain.reference);
  if (inputSpec === undefined || outputSpec === undefined || inputSpec.decimals !== idec || outputSpec.decimals !== odec) throw new Error("Pool/catalog decimal mismatch");
  const input = nativeMint(im, account(batch, im), policy.coverage.inputProfile, idec);
  const output = nativeMint(om, account(batch, om), policy.coverage.outputProfile, odec);
  nativeToken(iv, account(batch, iv), input.program, im, poolId);
  nativeToken(ov, account(batch, ov), output.program, om, poolId);
  const configAccount = account(batch, pool.configId);
  const bitmapKey = getPdaExBitmapAccount(DEX, poolId).publicKey, bitmapAccount = account(batch, bitmapKey);
  if (![configAccount, bitmapAccount, account(batch, pool.observationId)].every((a) => a.owner.equals(DEX))) throw new Error("Foreign route account owner");
  const bitmap = TickArrayBitmapExtensionLayout.decode(bitmapAccount.data);
  if (!bitmap.poolId.equals(poolId)) throw new Error("Bitmap pool mismatch");
  const config = ClmmConfigLayout.decode(configAccount.data);
  if (config.tickSpacing !== pool.tickSpacing) throw new Error("CLMM tick spacing mismatch");
  const clock = account(batch, SYSVAR_CLOCK_PUBKEY).data;
  const sourceAtMs = Number(clock.readBigInt64LE(32)) * 1000;
  if (!Number.isSafeInteger(sourceAtMs) || batch.observedAtMs - sourceAtMs >= Math.min(5000, policy.rule.maxAgeMs) || sourceAtMs > batch.observedAtMs) throw new Error("Stale/future native clock");
  if (!Number.isSafeInteger(batch.slot) || batch.slot <= 0 || BigInt(batch.slot) !== clock.readBigUInt64LE(0)) throw new Error("Incoherent slot/clock");
  if (input.scaled !== null) corporateActionGate(input.scaled, clock.readBigInt64LE(32));
  if ((pool.status & 16) !== 0 || pool.startTime.gt(new BN(Math.floor(sourceAtMs / 1000)))) throw new Error("Pool swaps disabled/not open");
  const start = TickArrayUtil.getTickArrayStartIndex(pool.tickCurrent, pool.tickSpacing);
  const ticks = [...batch.accounts].filter(([, a]) => a.owner.equals(DEX) && a.data.length === TickArrayLayout.span)
    .map(([key, a]) => ({ address: new PublicKey(key), value: TickArrayLayout.decode(a.data) }));
  if (ticks.some((t) => !t.value.poolId.equals(poolId))) throw new Error("Foreign tick array");
  const ordered = ticks.filter((t) => zeroForOne ? t.value.startTickIndex <= start : t.value.startTickIndex >= start)
    .sort((a, b) => zeroForOne ? b.value.startTickIndex - a.value.startTickIndex : a.value.startTickIndex - b.value.startTickIndex);
  const amount = BigInt(policy.amountRaw), sample = amount / 100n;
  if (sample <= 0n) throw new Error("Amount too small for meaningful executable quote");
  const compute = (raw: bigint) => swapInternal({ programId: DEX, poolId, poolInfo: structuredClonePool(pool),
    tickArrays: ordered, configInfo: config, tickarrayBitmapExtension: bitmap, amountSpecified: new BN(raw.toString()),
    sqrtPriceLimitX64: new BN(0), zeroForOne, isBaseInput: true, blockTimestamp: Math.floor(sourceAtMs / 1000), includeExtraTickArrays: false });
  const full = compute(amount), small = compute(sample);
  if (!full.allTrade || !small.allTrade || !full.amountSpecifiedRemaining.isZero() || full.amountCalculated.lten(0) || small.amountCalculated.lten(0)) throw new Error("No complete liquid exit quote");
  const out = BigInt(full.amountCalculated.toString()), sampleOut = BigInt(small.amountCalculated.toString());
  const minimum = out * BigInt(10_000 - policy.slippageBps) / 10_000n;
  const floor = BigInt(policy.minimumOutputRaw);
  if (out < floor) throw new Error("Executable proceeds below user floor");
  const selected = full.accounts.map((key) => key.toBase58());
  if (selected.length === 0 || selected.length > 6 || selected.some((key) => !batch.accounts.has(key))) throw new Error("Unsupported or uncaptured tick route");
  return { inputRaw: amount.toString(), outputRaw: out.toString(), minimumOutputRaw: (minimum > floor ? minimum : floor).toString(),
    routeKeys: [im, om, input.program, output.program, DEX, poolId, pool.configId, iv, ov, pool.observationId].map((k) => k.toBase58()),
    ticks: [bitmapKey.toBase58(), ...selected], slot: batch.slot, sourceAtMs, observedAtMs: batch.observedAtMs,
    stateHash: stateHash(batch), programVersion: policy.coverage.programVersion,
    sampleInputRaw: sample.toString(), sampleOutputRaw: sampleOut.toString(),
    priceImpactBps: ratio(10_000n * (sampleOut * amount - out * sample), sampleOut * amount) };
}

function structuredClonePool(pool: ReturnType<typeof PoolInfoLayout.decode>) {
  // SDK simulator mutates dynamic-fee state. Decode an independent native copy.
  const bytes = Buffer.alloc(PoolInfoLayout.span); PoolInfoLayout.encode(pool, bytes);
  return PoolInfoLayout.decode(bytes);
}
