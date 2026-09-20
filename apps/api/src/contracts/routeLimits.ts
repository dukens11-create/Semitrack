/** Application safety/product limit; Trimble's documented provider ceiling is higher.
 * Shared directly with React Native. Keep this module dependency-free.
 */
export const MAX_INTERMEDIATE_STOPS = 25;
export const MAX_ROUTE_LOCATIONS = MAX_INTERMEDIATE_STOPS + 2;
export const MAX_ROUTE_LEGS = MAX_ROUTE_LOCATIONS - 1;
