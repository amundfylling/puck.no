/** Pages route params retain percent encoding for Nordic tournament slugs. */
export function tournamentRouteSlug(param: string | string[] | undefined): string | null {
  if (typeof param !== 'string') return null;
  try {
    return decodeURIComponent(param);
  } catch {
    return null;
  }
}
