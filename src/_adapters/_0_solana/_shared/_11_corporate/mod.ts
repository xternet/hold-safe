type Adjustment = { multiplier: number; newMultiplier: number; newMultiplierEffectiveTimestamp: bigint };

/** xStocks announces activation at 00:30 UTC after ex-date; trust requires timely issuer publication. */
export function corporateActionGate(config: Adjustment, seconds: bigint): void {
  if (config.multiplier === config.newMultiplier) return;
  const activation = config.newMultiplierEffectiveTimestamp;
  if (activation <= 0n || activation % 86400n !== 1800n || activation > 9223372036854775507n) {
    throw new Error("Corporate action schedule unsupported");
  }
  // Full UTC ex-date, then the 00:30 activation and our five-minute settling buffer.
  if (seconds >= activation - 88200n && seconds < activation + 300n) {
    throw new Error("Corporate action window: automatic protection temporarily unavailable");
  }
}
