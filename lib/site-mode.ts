/** Defined only by the dedicated GitHub Pages build; the Worker build stays unchanged. */
declare const __COURTSIDE_PAGES_BASE__: string;
export const STATIC_PAGES = typeof __COURTSIDE_PAGES_BASE__ !== 'undefined';
export const SITE_BASE = STATIC_PAGES ? `/${__COURTSIDE_PAGES_BASE__.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/') : '/';
export function assetPath(path: string) { return SITE_BASE + path.replace(/^\/+/, ''); }
