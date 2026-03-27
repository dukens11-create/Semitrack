type FuelStop = {
  id: string;
  name: string;
  dieselPrice: number;
  detourMiles: number;
  defAvailable: boolean;
  truckSafe: boolean;
};

export function rankFuelStops(stops: FuelStop[]) {
  return stops
    .map((s) => {
      let score = 0;

      score += (5 - Math.min(s.dieselPrice, 5)) * 30;
      score += Math.max(0, 20 - s.detourMiles) * 3;
      if (s.defAvailable) score += 15;
      if (s.truckSafe) score += 25;

      return { ...s, score: Number(score.toFixed(1)) };
    })
    .sort((a, b) => b.score - a.score);
}
