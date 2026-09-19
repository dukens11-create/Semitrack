import type { ImageSourcePropType } from 'react-native';
import type { Poi } from './PoiService';

// Artwork supplied by the user. Identity only: never truck-access or availability evidence.
export const stationBrandPictures = {
  pilot: require('../../assets/station-logos/pilot.png') as ImageSourcePropType,
  'flying-j':
    require('../../assets/station-logos/flying-j.png') as ImageSourcePropType,
  loves: require('../../assets/station-logos/loves.png') as ImageSourcePropType,
  ta: require('../../assets/station-logos/ta.png') as ImageSourcePropType,
  petro: require('../../assets/station-logos/petro.png') as ImageSourcePropType,
  ambest:
    require('../../assets/station-logos/ambest.png') as ImageSourcePropType,
  bucees:
    require('../../assets/station-logos/bucees.png') as ImageSourcePropType,
  'road-ranger':
    require('../../assets/station-logos/road-ranger.png') as ImageSourcePropType,
  'sapp-bros':
    require('../../assets/station-logos/sapp-bros.png') as ImageSourcePropType,
  'kwik-trip':
    require('../../assets/station-logos/kwik-trip.png') as ImageSourcePropType,
  'kwik-star':
    require('../../assets/station-logos/kwik-star.png') as ImageSourcePropType,
  maverik:
    require('../../assets/station-logos/maverik.png') as ImageSourcePropType,
  speedway:
    require('../../assets/station-logos/speedway.png') as ImageSourcePropType,
  caseys:
    require('../../assets/station-logos/caseys.png') as ImageSourcePropType,
  thorntons:
    require('../../assets/station-logos/thorntons.png') as ImageSourcePropType,
  cenex: require('../../assets/station-logos/cenex.png') as ImageSourcePropType,
  'circle-k':
    require('../../assets/station-logos/circle-k.png') as ImageSourcePropType,
  '76': require('../../assets/station-logos/76.png') as ImageSourcePropType,
  chevron:
    require('../../assets/station-logos/chevron.png') as ImageSourcePropType,
  exxon: require('../../assets/station-logos/exxon.png') as ImageSourcePropType,
  shell: require('../../assets/station-logos/shell.png') as ImageSourcePropType,
  bp: require('../../assets/station-logos/bp.png') as ImageSourcePropType,
  mobil: require('../../assets/station-logos/mobil.png') as ImageSourcePropType,
  valero:
    require('../../assets/station-logos/valero.png') as ImageSourcePropType,
  sinclair:
    require('../../assets/station-logos/sinclair.png') as ImageSourcePropType,
  'phillips-66':
    require('../../assets/station-logos/phillips-66.png') as ImageSourcePropType,
  texaco:
    require('../../assets/station-logos/texaco.png') as ImageSourcePropType,
  marathon:
    require('../../assets/station-logos/marathon.png') as ImageSourcePropType,
  arco: require('../../assets/station-logos/arco.png') as ImageSourcePropType,
  'mobil-travel-center':
    require('../../assets/station-logos/mobil-travel-center.png') as ImageSourcePropType,
  'petro-canada':
    require('../../assets/station-logos/petro-canada.png') as ImageSourcePropType,
  'petro-pass':
    require('../../assets/station-logos/petro-pass.png') as ImageSourcePropType,
  esso: require('../../assets/station-logos/esso.png') as ImageSourcePropType,
  pioneer:
    require('../../assets/station-logos/pioneer.png') as ImageSourcePropType,
  'fas-gas-plus':
    require('../../assets/station-logos/fas-gas-plus.png') as ImageSourcePropType,
  onroute:
    require('../../assets/station-logos/onroute.png') as ImageSourcePropType,
  husky: require('../../assets/station-logos/husky.png') as ImageSourcePropType,
  ultramar:
    require('../../assets/station-logos/ultramar.png') as ImageSourcePropType,
  irving:
    require('../../assets/station-logos/irving.png') as ImageSourcePropType,
  canco: require('../../assets/station-logos/canco.png') as ImageSourcePropType,
  'co-op':
    require('../../assets/station-logos/co-op.png') as ImageSourcePropType,
  tempo: require('../../assets/station-logos/tempo.png') as ImageSourcePropType,
  extramile:
    require('../../assets/station-logos/extramile.png') as ImageSourcePropType,
  macewen:
    require('../../assets/station-logos/macewen.png') as ImageSourcePropType,
  wilsons:
    require('../../assets/station-logos/wilsons.png') as ImageSourcePropType,
  kings: require('../../assets/station-logos/kings.png') as ImageSourcePropType,
  'bulkley-valley':
    require('../../assets/station-logos/bulkley-valley.png') as ImageSourcePropType,
  'petro-seven':
    require('../../assets/station-logos/petro-seven.png') as ImageSourcePropType,
  'oxxo-gas':
    require('../../assets/station-logos/oxxo-gas.png') as ImageSourcePropType,
  pemex: require('../../assets/station-logos/pemex.png') as ImageSourcePropType,
  g500: require('../../assets/station-logos/g500.png') as ImageSourcePropType,
  totalenergies:
    require('../../assets/station-logos/totalenergies.png') as ImageSourcePropType,
  'bp-mexico':
    require('../../assets/station-logos/bp-mexico.png') as ImageSourcePropType,
  'chevron-mexico':
    require('../../assets/station-logos/chevron-mexico.png') as ImageSourcePropType,
  'shell-mexico':
    require('../../assets/station-logos/shell-mexico.png') as ImageSourcePropType,
  'mobil-mexico':
    require('../../assets/station-logos/mobil-mexico.png') as ImageSourcePropType,
  redco: require('../../assets/station-logos/redco.png') as ImageSourcePropType,
  orsan: require('../../assets/station-logos/orsan.png') as ImageSourcePropType,
};
export type StationBrandId = keyof typeof stationBrandPictures;
const aliases: Record<StationBrandId, string[]> = {
  '76': ['76'],
  pilot: ['pilot'],
  'flying-j': ['flying j'],
  loves: ["love's", 'loves'],
  ta: ['ta', 'travelcenters of america', 'travel centers of america'],
  petro: ['petro', 'petro stopping centers'],
  ambest: ['ambest'],
  bucees: ["buc-ee's", 'bucees'],
  'road-ranger': ['road ranger'],
  'sapp-bros': ['sapp bros', 'sapp brothers'],
  'kwik-trip': ['kwik trip'],
  'kwik-star': ['kwik star'],
  maverik: ['maverik'],
  speedway: ['speedway'],
  caseys: ["casey's", 'caseys'],
  thorntons: ['thorntons'],
  cenex: ['cenex'],
  'circle-k': ['circle k'],
  chevron: ['chevron'],
  exxon: ['exxon', 'exxonmobil'],
  shell: ['shell'],
  bp: ['bp'],
  mobil: ['mobil'],
  valero: ['valero'],
  sinclair: ['sinclair'],
  'phillips-66': ['phillips 66'],
  texaco: ['texaco'],
  marathon: ['marathon'],
  arco: ['arco'],
  'mobil-travel-center': ['mobil travel center'],
  'petro-canada': ['petro canada'],
  'petro-pass': ['petro pass'],
  esso: ['esso'],
  pioneer: ['pioneer'],
  'fas-gas-plus': ['fas gas plus', 'fas gas'],
  onroute: ['onroute'],
  husky: ['husky'],
  ultramar: ['ultramar'],
  irving: ['irving'],
  canco: ['canco'],
  'co-op': ['co op', 'coop'],
  tempo: ['tempo'],
  extramile: ['extramile', 'extra mile'],
  macewen: ['macewen'],
  wilsons: ["wilson's", 'wilsons'],
  kings: ["king's", 'kings'],
  'bulkley-valley': ['bulkley valley', 'bv'],
  'petro-seven': ['petro seven', 'petro 7'],
  'oxxo-gas': ['oxxo gas'],
  pemex: ['pemex'],
  g500: ['g500', 'g 500'],
  totalenergies: ['totalenergies', 'total energies'],
  'bp-mexico': ['bp mexico'],
  'chevron-mexico': ['chevron mexico'],
  'shell-mexico': ['shell mexico'],
  'mobil-mexico': ['mobil mexico'],
  redco: ['redco'],
  orsan: ['orsan'],
};
function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9#]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
    : '';
}
const names = (Object.keys(aliases) as StationBrandId[])
  .flatMap(id => aliases[id].map(alias => ({ id, alias: normalized(alias) })))
  .sort((a, b) => b.alias.length - a.alias.length);
function inCountry(id: StationBrandId, poi: Poi): StationBrandId {
  const country = normalized(poi.countryCode ?? poi.country);
  if (['mx', 'mex', 'mexico'].includes(country)) {
    if (id === 'bp') return 'bp-mexico';
    if (id === 'chevron') return 'chevron-mexico';
    if (id === 'shell') return 'shell-mexico';
    if (id === 'mobil') return 'mobil-mexico';
  }
  return id;
}
export function stationBrandId(poi: Poi): StationBrandId | undefined {
  if (!['truck_stop', 'fuel_stop', 'gas_station'].includes(poi.category ?? ''))
    return undefined;
  const structured = normalized(poi.brand) || normalized(poi.brandName);
  // An explicit unknown brand must not be replaced with a guess from an address/name.
  if (structured) {
    const match = names.find(item => item.alias === structured);
    return match ? inCountry(match.id, poi) : undefined;
  }
  const name = normalized(poi.name);
  const match = names.find(item => {
    if (name === item.alias) return true;
    if (!name.startsWith(item.alias + ' ')) return false;
    const suffix = name.slice(item.alias.length + 1);
    return /^(?:#?\d+\b|(?:truck stop|travel center|travel centre|stopping center|gas station|service station|fuel center|fuel centre|station)\b)/.test(
      suffix,
    );
  });
  return match ? inCountry(match.id, poi) : undefined;
}
