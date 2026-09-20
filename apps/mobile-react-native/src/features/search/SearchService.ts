import { z } from 'zod';
import { DriverError } from '../../errors/driverErrors';
import { coordinateSchema, type Coordinate } from '../../models/contracts';
import type { Stop } from '../stops/StopPlan';

// Locality identity comes from provider context, never a city/state lookup table.
const localityContextSchema = z.object({
  region: z
    .object({
      name: z.string().optional(),
      region_code: z.string().optional(),
      region_code_full: z.string().optional(),
    })
    .optional(),
  country: z
    .object({
      name: z.string().optional(),
      country_code: z.string().optional(),
      country_code_alpha_3: z.string().optional(),
    })
    .optional(),
});
const searchBoxResponseSchema = z.object({
  features: z.array(
    z.object({
      type: z.literal('Feature').optional(),
      geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([
          z.number().finite().min(-180).max(180),
          z.number().finite().min(-90).max(90),
        ]),
      }),
      properties: z.object({
        mapbox_id: z.string().min(1),
        feature_type: z.string().min(1),
        name: z.string().min(1),
        name_preferred: z.string().min(1).optional(),
        full_address: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        context: localityContextSchema.optional(),
        place_formatted: z.string().min(1).optional(),
      }),
    }),
  ),
});

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      mapbox_id: z.string().min(1),
      feature_type: z.string().min(1),
      name: z.string().min(1),
      name_preferred: z.string().min(1).optional(),
      full_address: z.string().min(1).optional(),
      place_formatted: z.string().min(1).optional(),
    }),
  ),
});

const retrieveSchema = z.object({
  features: z.array(
    z.object({
      type: z.literal('Feature').optional(),
      geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([
          z.number().finite().min(-180).max(180),
          z.number().finite().min(-90).max(90),
        ]),
      }),
      properties: z.object({
        mapbox_id: z.string().min(1),
        feature_type: z.string().min(1),
        name: z.string().min(1),
        name_preferred: z.string().min(1).optional(),
        full_address: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        context: localityContextSchema.optional(),
        place_formatted: z.string().min(1).optional(),
      }),
    }),
  ),
});

const geocodingResponseSchema = z.object({
  features: z.array(
    z
      .object({
        id: z.string().min(1).optional(),
        geometry: z.object({
          type: z.literal('Point'),
          coordinates: z.tuple([
            z.number().finite().min(-180).max(180),
            z.number().finite().min(-90).max(90),
          ]),
        }),
        properties: z.object({
          mapbox_id: z.string().min(1).optional(),
          full_address: z.string().min(1).optional(),
          name: z.string().min(1),
        }),
      })
      .refine(
        item => !!(item.id || item.properties.mapbox_id),
        'Place identity missing',
      ),
  ),
});

type SearchBoxProperties = {
  mapbox_id: string;
  feature_type: string;
  name: string;
  name_preferred?: string;
  full_address?: string;
  address?: string;
  place_formatted?: string;
};

function displayName(properties: SearchBoxProperties) {
  if (properties.feature_type === 'poi') {
    if (properties.full_address)
      return properties.name + ' - ' + properties.full_address;
    const address = [properties.address, properties.place_formatted]
      .filter(Boolean)
      .join(', ');
    if (address) return properties.name + ' - ' + address;
  }

  return (
    properties.full_address ?? properties.name_preferred ?? properties.name
  );
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Search cancelled.');
}
function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function matchesLocality(
  query: string,
  properties: z.infer<
    typeof searchBoxResponseSchema
  >['features'][number]['properties'],
) {
  if (!['place', 'locality'].includes(properties.feature_type)) return false;
  const region = properties.context?.region,
    country = properties.context?.country;
  if (
    !region ||
    !country?.country_code ||
    !['us', 'ca', 'mx'].includes(country.country_code.toLowerCase())
  )
    return false;
  const regionNameParts = region.name
    ? normalized(region.name).split(' ').filter(Boolean)
    : [];
  const regionInitials =
    regionNameParts.length > 1
      ? regionNameParts.map(part => part[0]).join('')
      : undefined;

  const regions = [
    region.name,
    region.region_code,
    region.region_code?.split('-').pop(),
    region.region_code_full?.split('-').pop(),
    regionInitials,
  ].filter((v): v is string => !!v && normalized(v).length > 0);
  const countries = [
    '',
    country.name,
    country.country_code,
    country.country_code_alpha_3,
  ].filter((v): v is string => v !== undefined);
  return [properties.name, properties.name_preferred]
    .filter((v): v is string => !!v && normalized(v).length > 0)
    .some(name =>
      regions.some(area =>
        countries.some(
          nation =>
            normalized(query) === normalized([name, area, nation].join(' ')),
        ),
      ),
    );
}

function newSessionToken() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2) +
    '-' +
    Math.random().toString(36).slice(2)
  );
}

/**
 * Mapbox results are destination candidates only.
 *
 * A POI result does NOT prove truck access, truck parking, a truck entrance,
 * or that a commercial vehicle may legally reach the location. Truck routing
 * remains subject to the configured truck profile and truck-safe provider.
 */
export class SearchService {
  constructor(
    private publicMapToken: string,
    private transport: typeof fetch = fetch,
  ) {}

  async search(
    query: string,
    center?: Coordinate,
    signal?: AbortSignal,
  ): Promise<Stop[]> {
    const text = query.trim();

    if (text.length < 3) return [];

    if (
      text.length > 256 ||
      text.includes(';') ||
      text.split(/\s+/).length > 20
    ) {
      throw new Error(
        'Use a destination of up to 20 words and 256 characters, without semicolons.',
      );
    }

    // Preserve the existing centered POI path. Locality resolution never reads GPS.
    if (center) {
      const point = coordinateSchema.parse(center);

      const poiResults = await this.searchPoiSuggestions(text, point, signal);

      if (poiResults.length > 0) {
        // A nonempty GPS-biased result is not proof that an explicit city/region
        // was honored. Resolve that locality using the same provider flow.
        const locality = await this.resolveLocality(text, signal);
        if (locality) {
          const local = await this.searchPoiSuggestions(
            locality.term,
            locality.center,
            signal,
          );
          if (local.length) return local;
          return []; // Do not substitute an unrelated nearby business.
        }
        return poiResults;
      }
    }

    const params = new URLSearchParams({
      q: text,
      limit: '10',
      country: 'us,ca,mx',
    });

    if (center) {
      const point = coordinateSchema.parse(center);
      params.set('proximity', point.lng + ',' + point.lat);
    }

    const features = await this.searchBoxForward(params, signal);

    // Full-query results remain the fallback. When the provider can prove an
    // explicit locality from the query, search the business term around that
    // provider-derived locality even if the full-query response contains POIs.
    // This prevents unrelated POIs from blocking an explicit city/region search.
    const locality = await this.resolveLocality(text, signal);
    if (locality) {
      try {
        const pois = await this.searchPoiSuggestions(
          locality.term,
          locality.center,
          signal,
        );
        if (pois.length) return pois;
      } catch {
        checkCancelled(signal);
        // Failed interpretation cannot replace the original provider results.
      }
    }

    checkCancelled(signal);
    return features.map(item => ({
      id: item.properties.mapbox_id,
      name: displayName(item.properties),
      lng: item.geometry.coordinates[0],
      lat: item.geometry.coordinates[1],
    }));
  }

  async reverse(coordinate: Coordinate, signal?: AbortSignal): Promise<Stop[]> {
    const point = coordinateSchema.parse(coordinate);

    return this.geocode(
      'reverse',
      new URLSearchParams({
        longitude: String(point.lng),
        latitude: String(point.lat),
        types: 'address',
        limit: '1',
      }),
      signal,
    );
  }

  private validateToken() {
    if (!this.publicMapToken.startsWith('pk.')) {
      throw new DriverError('PLACE_SEARCH_CONFIGURATION', 'configuration');
    }
  }

  private async resolveLocality(text: string, signal?: AbortSignal) {
    const words = text.split(/\s+/);
    // Numeric street addresses remain ordinary forward searches. A split is only
    // a hypothesis: the entire suffix must match a provider locality AND region.
    if (/^\d+\s/.test(text) || words.length < 3) return null;
    // Bound speculative lookups; longer/ambiguous business names retain full-query search.
    for (let split = 1; split <= Math.min(4, words.length - 2); split++) {
      checkCancelled(signal);
      const term = words
        .slice(0, split)
        .join(' ')
        .replace(/[,\s]+$/, '');
      if (!normalized(term)) continue;
      const suffix = words
        .slice(split)
        .join(' ')
        .replace(/^[,\s]+/, '');
      try {
        const features = await this.searchBoxForward(
          new URLSearchParams({
            q: suffix,
            country: 'us,ca,mx',
            types: 'place,locality',
            limit: '10',
          }),
          signal,
        );
        const matches = features.filter(item =>
          matchesLocality(suffix, item.properties),
        );
        if (matches.length > 1) return null;
        if (matches.length === 1) {
          const feature = matches[0]!;
          return {
            term,
            center: {
              lng: feature.geometry.coordinates[0],
              lat: feature.geometry.coordinates[1],
            },
          };
        }
      } catch {
        checkCancelled(signal);
        return null;
      }
    }
    return null;
  }

  private async searchPoiSuggestions(
    text: string,
    center: Coordinate,
    signal?: AbortSignal,
  ): Promise<Stop[]> {
    this.validateToken();

    const sessionToken = newSessionToken();
    const params = new URLSearchParams({
      q: text,
      limit: '10',
      country: 'us,ca,mx',
      types: 'poi',
      proximity: center.lng + ',' + center.lat,
      session_token: sessionToken,
      access_token: this.publicMapToken,
    });

    const suggestions = await this.requestJson(
      'https://api.mapbox.com/search/searchbox/v1/suggest?' + params.toString(),
      signal,
      suggestionSchema,
    );

    const candidates = suggestions.suggestions
      .filter(
        (item, index, all) =>
          item.feature_type === 'poi' &&
          all.findIndex(other => other.mapbox_id === item.mapbox_id) === index,
      )
      .slice(0, 10);
    if (candidates.length === 0) return [];

    const retrieved = await Promise.all(
      candidates.map(async suggestion => {
        const retrieveParams = new URLSearchParams({
          session_token: sessionToken,
          access_token: this.publicMapToken,
        });

        try {
          const result = await this.requestJson(
            'https://api.mapbox.com/search/searchbox/v1/retrieve/' +
              encodeURIComponent(suggestion.mapbox_id) +
              '?' +
              retrieveParams.toString(),
            signal,
            retrieveSchema,
          );

          const feature = result.features[0];
          if (
            result.features.length !== 1 ||
            !feature ||
            feature.properties.feature_type !== 'poi' ||
            feature.properties.mapbox_id !== suggestion.mapbox_id
          )
            return null;

          return {
            id: feature.properties.mapbox_id,
            name: displayName(feature.properties),
            lng: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
          } satisfies Stop;
        } catch {
          return null;
        }
      }),
    );

    checkCancelled(signal);
    return retrieved.filter((item): item is Stop => item !== null);
  }

  private async searchBoxForward(
    params: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof searchBoxResponseSchema>['features']> {
    this.validateToken();
    params.set('access_token', this.publicMapToken);

    const parsed = await this.requestJson(
      'https://api.mapbox.com/search/searchbox/v1/forward?' + params.toString(),
      signal,
      searchBoxResponseSchema,
    );

    return parsed.features.filter(
      (item, index, all) =>
        all.findIndex(
          other => other.properties.mapbox_id === item.properties.mapbox_id,
        ) === index,
    );
  }

  private async requestJson<T>(
    url: string,
    signal: AbortSignal | undefined,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();

    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();

    const timer = setTimeout(abort, 15000);

    try {
      checkCancelled(signal);
      const response = await this.transport(url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        // Do not read or retain error bodies: they can echo addresses or tokens.
        const code =
          response.status === 401
            ? 'PLACE_SEARCH_UNAUTHORIZED'
            : response.status === 403
            ? 'PLACE_SEARCH_FORBIDDEN'
            : response.status === 429
            ? 'PLACE_SEARCH_RATE_LIMITED'
            : response.status === 400 || response.status === 422
            ? 'PLACE_SEARCH_REQUEST_INVALID'
            : 'PLACE_SEARCH_UNAVAILABLE';
        throw new DriverError(code, 'provider');
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new DriverError('PLACE_SEARCH_INVALID_RESPONSE', 'provider');
      }
      checkCancelled(signal);
      if (controller.signal.aborted) throw new Error('Request expired');
      const parsed = schema.safeParse(data);
      if (!parsed.success)
        throw new DriverError('PLACE_SEARCH_INVALID_RESPONSE', 'provider');
      return parsed.data;
    } catch (error) {
      checkCancelled(signal);
      if (controller.signal.aborted)
        throw new DriverError('PLACE_SEARCH_TIMEOUT', 'network');
      if (error instanceof DriverError) throw error;
      throw new DriverError('PLACE_SEARCH_NETWORK', 'network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async geocode(
    kind: 'reverse',
    params: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<Stop[]> {
    this.validateToken();
    params.set('access_token', this.publicMapToken);

    const result = await this.requestJson(
      'https://api.mapbox.com/search/geocode/v6/' +
        kind +
        '?' +
        params.toString(),
      signal,
      geocodingResponseSchema,
    );
    return result.features.map(item => ({
      id: item.id ?? item.properties.mapbox_id!,
      name: item.properties.full_address ?? item.properties.name,
      lng: item.geometry.coordinates[0],
      lat: item.geometry.coordinates[1],
    }));
  }
}
