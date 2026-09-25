export type Rational = Readonly<{ n: bigint; d: bigint }>;

export function ratio(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new Error("Zero denominator");
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  return Object.freeze({ n: n / a, d: d / a });
}

export function decimal(value: string): Rational {
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const point = value.indexOf(".");
  if (point < 0) return ratio(BigInt(value), 1n);
  const digits = value.length - point - 1;
  return ratio(BigInt(value.replace(".", "")), 10n ** BigInt(digits));
}

export function units(raw: bigint, decimals: number): Rational {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid uint8 decimal scale");
  return ratio(raw, 10n ** BigInt(decimals));
}

export function add(a: Rational, b: Rational): Rational { return ratio(a.n * b.d + b.n * a.d, a.d * b.d); }
export function multiply(a: Rational, b: Rational): Rational { return ratio(a.n * b.n, a.d * b.d); }
export function divide(a: Rational, b: Rational): Rational { return ratio(a.n * b.d, a.d * b.n); }
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function floor(value: Rational): bigint {
  const truncated = value.n / value.d;
  return value.n < 0n && value.n % value.d !== 0n ? truncated - 1n : truncated;
}
export function divergenceBps(referenceUsd: Rational, exitUsd: Rational): Rational {
  if (referenceUsd.n <= 0n || exitUsd.n < 0n) throw new Error("Invalid valuation");
  const difference = add(referenceUsd, ratio(-exitUsd.n, exitUsd.d));
  return multiply(divide(difference, referenceUsd), ratio(10_000n, 1n));
}
