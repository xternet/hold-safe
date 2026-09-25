import { ratio, type Rational } from "../../../../../_kernel/mod";

export function binaryMultiplier(value: number): Rational {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid native multiplier");
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value, false);
  const bits = bytes.getBigUint64(0, false), exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const numerator = exponent === 0 ? fraction : (1n << 52n) + fraction;
  const shift = exponent === 0 ? -1074 : exponent - 1075;
  return shift >= 0 ? ratio(numerator << BigInt(shift), 1n) : ratio(numerator, 1n << BigInt(-shift));
}
