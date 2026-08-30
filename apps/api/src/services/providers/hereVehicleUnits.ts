const CENTIMETERS_PER_FOOT = 30.48;
const KILOGRAMS_PER_POUND = 0.45359237;

/** HERE Routing v8 truck dimensions are whole centimeters. */
export function feetToHereCentimeters(feet: number): string {
  return String(Math.round(feet * CENTIMETERS_PER_FOOT));
}

/** HERE Routing v8 truck weights are whole kilograms. */
export function poundsToHereKilograms(pounds: number): string {
  return String(Math.round(pounds * KILOGRAMS_PER_POUND));
}
