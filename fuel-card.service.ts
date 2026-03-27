export type FuelCardStop = {
  id: string;
  name: string;
  acceptedNetworks: string[];
  dieselPrice: number;
  defAvailable: boolean;
  truckSafe: boolean;
};

export function scoreFuelCardStops(stops: FuelCardStop[], preferredNetwork: string) {
  return stops
    .map((stop) => {
      let score = 0;
      if (stop.acceptedNetworks.includes(preferredNetwork)) score += 50;
      if (stop.truckSafe) score += 25;
      if (stop.defAvailable) score += 10;
      score += (5 - Math.min(stop.dieselPrice, 5)) * 20;
      return { ...stop, score: Number(score.toFixed(1)) };
    })
    .sort((a, b) => b.score - a.score);
}
