/**
 * Returns '/gg' if currently on a /gg route, '' otherwise.
 * Used to prefix internal links so components work on both / and /gg routes.
 */
export function useBasePath(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname.startsWith('/gg') ? '/gg' : '';
}
