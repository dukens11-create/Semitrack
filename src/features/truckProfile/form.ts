import { z } from 'zod';
import { type TruckProfile } from '../../models/contracts';
import { ApiError } from '../../services/api/ApiClient';
import { verifyRoutingProfile } from './equipment';
export const dimensionFields = ['heightFt', 'widthFt', 'lengthFt'] as const;
export const hazmatLabels: Record<string, string> = {
  explosive: 'Explosives',
  gas: 'Gases',
  flammable: 'Flammable materials',
  combustible: 'Combustible materials',
  organic: 'Organic peroxides',
  poison: 'Poisonous materials',
  radioactive: 'Radioactive materials',
  corrosive: 'Corrosive materials',
  poisonousInhalation: 'Poisonous by inhalation',
  harmfulToWater: 'Harmful to water',
  other: 'Other hazardous goods',
};
export const fieldMessages: Record<string, string> = {
  name: 'Enter a profile name of 1–80 characters.',
  tractorType: 'Choose or enter a tractor type.',
  trailerType: 'Choose a commercial trailer type, or No Trailer.',
  unitNumber: 'Use at most 40 characters for the unit number.',
  trailerNumber: 'Use at most 40 characters for the trailer number.',
  heightFt:
    'Enter the measured loaded height: 5–15 ft for the current routing service. Do not lower the actual height to fit.',
  widthFt:
    'Enter the measured loaded width: 5–8.5 ft for the current routing service. Do not lower the actual width to fit.',
  lengthFt:
    'Enter the measured routing length: 8–70 ft for the current routing service. Do not lower the actual length to fit.',
  heightIn: 'Enter inches from 0 up to, but not including, 12.',
  widthIn: 'Enter inches from 0 up to, but not including, 12.',
  lengthIn: 'Enter inches from 0 up to, but not including, 12.',
  weightLbs:
    'Enter the actual gross routing weight: 1,500–156,470 whole pounds.',
  currentWeightLbs:
    'Enter actual current weight in whole pounds, from 1,000 up to gross weight, or leave blank.',
  weightPerAxleLbs:
    'Enter the measured maximum loaded axle-group weight: 800–45,000 whole pounds, or leave blank.',
  axleCount: 'Enter the actual number of axles: a whole number from 2–14.',
  trailerCount:
    'Enter the actual number of trailers: 0–4. Use 0 only with No Trailer.',
  hazardousGoods: 'Review the hazardous-goods classes actually carried.',
};
export class TruckFormError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Review the highlighted truck profile values.');
  }
}
export function inchesKey(key: string) {
  return key.replace(/Ft$/, 'In');
}
export function dimensionForm(profile: TruckProfile): Record<string, string> {
  return Object.fromEntries(
    dimensionFields.flatMap(key => {
      const feet = Math.floor(profile[key]);
      const inches = Number(((profile[key] - feet) * 12).toFixed(8));
      return [
        [key, String(feet)],
        [inchesKey(key), String(inches)],
      ];
    }),
  );
}
function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))
    return NaN;
  return Number(value.trim());
}
export function parseTruckForm(form: Record<string, unknown>): TruckProfile {
  const converted = { ...form };
  const errors: Record<string, string> = {};
  for (const key of dimensionFields) {
    const fractionKey = inchesKey(key);
    const feet = readNumber(form[key]);
    const inches =
      form[fractionKey] === '' || form[fractionKey] == null
        ? 0
        : readNumber(form[fractionKey]);
    if (!Number.isFinite(feet) || feet < 0) errors[key] = fieldMessages[key]!;
    if (!Number.isFinite(inches) || inches < 0 || inches >= 12)
      errors[fractionKey] = fieldMessages[fractionKey]!;
    if (!Number.isInteger(feet) && inches !== 0)
      errors[key] =
        'Use whole feet with the inches field, or decimal feet with zero inches.';
    converted[key] = feet + inches / 12;
    delete converted[fractionKey];
  }
  for (const key of [
    'weightLbs',
    'currentWeightLbs',
    'weightPerAxleLbs',
    'axleCount',
    'trailerCount',
  ]) {
    converted[key] =
      form[key] === '' || form[key] == null ? null : readNumber(form[key]);
  }
  if (Object.keys(errors).length) throw new TruckFormError(errors);
  try {
    return verifyRoutingProfile(converted);
  } catch (error) {
    throw new TruckFormError(profileErrors(error).fields);
  }
}
export function profileErrors(error: unknown): {
  message: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  if (error instanceof TruckFormError)
    return { message: error.message, fields: error.fields };
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) {
      const key = String(issue.path[0] ?? '');
      if (fieldMessages[key]) fields[key] = fieldMessages[key]!;
    }
  } else if (error instanceof ApiError) {
    for (const key of error.validationFields)
      if (fieldMessages[key]) fields[key] = fieldMessages[key]!;
    if (error.status === 401)
      return {
        message: 'Sign in again before updating your truck profile.',
        fields,
      };
    if (error.retryable || error.status === 0)
      return {
        message:
          'Unable to reach SemiTraX. Your profile was not confirmed. Try again when connected.',
        fields,
      };
  } else if (error instanceof Error) {
    const prefixMap: Record<string, string> = {
      'Height (ft)': 'heightFt',
      'Width (ft)': 'widthFt',
      'Length (ft)': 'lengthFt',
      'Gross weight (lb)': 'weightLbs',
      'Weight per axle': 'weightPerAxleLbs',
      Axles: 'axleCount',
      'No Trailer': 'trailerCount',
      'Choose or enter both': 'tractorType',
      'This trailer description': 'trailerType',
    };
    for (const [prefix, key] of Object.entries(prefixMap))
      if (error.message.startsWith(prefix)) fields[key] = fieldMessages[key]!;
  }
  return {
    message: Object.keys(fields).length
      ? 'Review the highlighted truck profile values.'
      : 'Unable to confirm this truck profile. Review its current values and try again.',
    fields,
  };
}
