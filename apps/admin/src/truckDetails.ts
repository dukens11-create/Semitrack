export function feetAndInches(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "Not recorded";
  const totalInches = Math.round(value * 1200) / 100;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round((totalInches - feet * 12) * 100) / 100;
  return feet + " ft" + (inches ? " " + inches + " in" : "");
}
const goods: Record<string, string> = {
  explosive: "Explosives", gas: "Gases", flammable: "Flammable materials", combustible: "Combustible materials",
  organic: "Organic peroxides", poison: "Poisonous materials", radioactive: "Radioactive materials",
  corrosive: "Corrosive materials", poisonousInhalation: "Poisonous by inhalation", harmfulToWater: "Harmful to water", other: "Other hazardous goods",
};
export function truckDetails(truck: Record<string, unknown>): Array<[string, string]> {
  const text = (key: string) => typeof truck[key] === "string" && String(truck[key]).trim() ? String(truck[key]) : "Not recorded";
  const number = (key: string, suffix = "") => typeof truck[key] === "number" && Number.isFinite(truck[key]) ? new Intl.NumberFormat("en-US").format(truck[key] as number) + suffix : "Not recorded";
  return [
    ["Profile name", text("name")], ["Tractor type", text("tractorType")], ["Trailer type", text("trailerType")],
    ["Unit number", text("unitNumber")], ["Trailer number", text("trailerNumber")],
    ["Height", feetAndInches(truck.heightFt)], ["Width", feetAndInches(truck.widthFt)], ["Routing length", feetAndInches(truck.lengthFt)],
    ["Gross routing weight", number("weightLbs", " lb")], ["Current weight", number("currentWeightLbs", " lb")],
    ["Maximum loaded axle-group weight", number("weightPerAxleLbs", " lb")], ["Axles", number("axleCount")], ["Trailers", number("trailerCount")],
    ["Hazardous goods", Array.isArray(truck.hazardousGoods) && truck.hazardousGoods.length ? truck.hazardousGoods.map(v => goods[String(v)] ?? "Unrecognized class — review required").join(", ") : truck.hazmatEnabled ? "Classes not recorded — review required" : "None declared"],
    ["Saved default", truck.isDefault === true ? "Yes — not proof of driver verification" : "No"],
    ["Driver verification", typeof truck.revision==='number' && truck.verifiedRevision===truck.revision && truck.verificationState==='VERIFIED' && typeof truck.verifiedAt==='string' ? 'Driver verified revision '+truck.revision : truck.verificationState==='ADMIN_UPDATED' ? 'Changed by operations — driver review required' : 'Not recorded by server; driver must review before routing'],
  ];
}
