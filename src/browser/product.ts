/**
 * What a shop says about a product in the page's metadata (schema.org
 * JSON-LD): its name, price, stock and rating. Shops put it there for search
 * engines, so it is often more exact than the page's text, where the price
 * may be split over several elements. It is still the page's own claim.
 */
export interface ProductData {
  name?: string;
  brand?: string;
  /** "34.99 USD", or a range for several offers. */
  price?: string;
  availability?: string;
  seller?: string;
  /** "4.4 of 5 (1286 reviews)". */
  rating?: string;
  sku?: string;
}

type Json = Record<string, unknown>;

const text = (value: unknown, limit = 120): string | undefined => {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  const clean = raw?.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, limit) : undefined;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const isType = (node: Json, type: string) => list(node['@type']).some((entry) => typeof entry === 'string' && entry.toLowerCase() === type.toLowerCase());
const named = (value: unknown): string | undefined => (typeof value === 'object' && value !== null ? text((value as Json).name) : text(value));

/** Every object in a JSON-LD document, however it is nested (@graph, arrays, mainEntity). */
function nodes(value: unknown, depth = 0): Json[] {
  if (depth > 6 || typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => nodes(entry, depth + 1));
  const node = value as Json;
  return [node, ...nodes(node['@graph'], depth + 1), ...nodes(node.mainEntity, depth + 1)];
}

/** The first product described in the given JSON-LD documents (the text of the page's ld+json scripts). */
export function productFromJsonLd(documents: string[]): ProductData | undefined {
  for (const source of documents) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    const product = nodes(parsed).find((node) => isType(node, 'Product'));
    if (!product) continue;
    const offers = list(product.offers).flatMap((offer) => nodes(offer)).filter((offer) => offer.price !== undefined || offer.lowPrice !== undefined);
    const offer = offers[0];
    const currency = text(offer?.priceCurrency, 8) ?? '';
    const amount = (value: unknown) => {
      const number = Number(String(value).replace(/,/g, ''));
      return Number.isFinite(number) && String(value).trim() !== '' ? String(value).trim().slice(0, 16) : undefined;
    };
    const low = amount(offer?.lowPrice);
    const high = amount(offer?.highPrice);
    const single = amount(offer?.price);
    const price = single ? `${single} ${currency}`.trim() : low ? `${low}${high && high !== low ? `–${high}` : ''} ${currency}`.trim() : undefined;
    const rating = product.aggregateRating as Json | undefined;
    const value = amount(rating?.ratingValue);
    const count = amount(rating?.reviewCount ?? rating?.ratingCount);
    const data: ProductData = {
      name: text(product.name, 160),
      brand: named(product.brand),
      price,
      // "https://schema.org/InStock" → "InStock".
      availability: text(offer?.availability, 60)?.replace(/^https?:\/\/schema\.org\//i, ''),
      seller: named(offer?.seller),
      rating: value ? `${value} of ${amount(rating?.bestRating) ?? '5'}${count ? ` (${count} reviews)` : ''}` : undefined,
      sku: text(product.sku ?? product.gtin13 ?? product.gtin ?? product.mpn, 40),
    };
    if (data.name || data.price) return data;
  }
  return undefined;
}

/** The product data as a few lines for the model, in front of the page's text. */
export function describeProduct(data: ProductData): string {
  const lines = [
    data.name && `- Name: ${data.name}`,
    data.brand && `- Brand: ${data.brand}`,
    data.price && `- Price: ${data.price}`,
    data.availability && `- Availability: ${data.availability}`,
    data.seller && `- Seller: ${data.seller}`,
    data.rating && `- Rating: ${data.rating}`,
    data.sku && `- SKU: ${data.sku}`,
  ].filter(Boolean);
  return `Product data from the page's metadata (the shop's own figures, before any choice of variant, shipping or coupon):\n${lines.join('\n')}`;
}
