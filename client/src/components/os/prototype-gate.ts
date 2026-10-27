/**
 * Prototype gate (S17). Prototype routes (the Academic Flight Deck preview) exist only in development
 * or when a build explicitly sets VITE_ENABLE_PROTOTYPES="true". In a normal production build this is a
 * compile-time false: the route is never registered and the sidebar link never renders.
 */
export const PROTOTYPES_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_PROTOTYPES === "true";

export const PREVIEW_FLIGHT_DECK_PATH = "/preview/flight-deck";

export function isPrototypePath(location: string): boolean {
  return location === "/preview" || location.startsWith("/preview/");
}
