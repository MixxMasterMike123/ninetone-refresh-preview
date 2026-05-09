/**
 * Shopify Admin API client (build-time only).
 *
 * SECURITY: Admin API token has full read/write access to the entire store.
 * This file MUST NEVER be imported by client-side code. Astro's import graph
 * keeps it server-side because it reads from `import.meta.env.SHOPIFY_*`
 * which are only resolved during SSR/build.
 *
 * For long-term safety, swap to Storefront API before launch (see
 * docs/api-shopify.md).
 */

import { cached } from "./cache";

const SHOP_DOMAIN = import.meta.env.SHOPIFY_SHOP_DOMAIN ?? "fc6d3a-d9.myshopify.com";
const PUBLIC_STORE_URL = import.meta.env.SHOPIFY_PUBLIC_STORE_URL ?? "https://shop.ninetone.com";
const ADMIN_TOKEN = import.meta.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = "2024-10";

export interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
}

export interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  product_type: string;
  status: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  image: ShopifyImage | null;
}

interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

async function shopifyFetch(path: string): Promise<Response> {
  if (!ADMIN_TOKEN) {
    throw new Error("SHOPIFY_ADMIN_TOKEN env var not set");
  }
  return fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
    },
  });
}

/** List products from the store. Optionally scoped to a Shopify collection. */
export function getProducts(opts?: {
  collectionId?: string;
  limit?: number;
}): Promise<ShopifyProduct[]> {
  const collectionId = opts?.collectionId ?? "";
  const limit = opts?.limit ?? 50;
  return cached("shopify-products", { collectionId, limit }, async () => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("status", "active");
    if (collectionId) params.set("collection_id", collectionId);

    const res = await shopifyFetch(`/products.json?${params}`);
    if (!res.ok) {
      throw new Error(`Shopify products failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as ShopifyProductsResponse;
    return json.products;
  });
}

/** Storefront URL for a product (so users can buy on shop.ninetone.com). */
export function productUrl(product: ShopifyProduct): string {
  return `${PUBLIC_STORE_URL}/products/${product.handle}`;
}

/** Lowest variant price as a formatted SEK string. */
export function productPrice(product: ShopifyProduct): string {
  const prices = product.variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  return `${min.toFixed(0)} kr`;
}
