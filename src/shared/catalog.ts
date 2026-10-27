export type CollectionId = 'kitchen' | 'attic' | 'letters' | 'vinyl' | 'garden' | 'wardrobe';

export interface Collection {
  id: CollectionId;
  name: string;
  blurb: string;
}

export interface Item {
  id: string;
  name: string;
  collection: CollectionId;
  /** Public base value. Worth `base * COLLECTION_MULTIPLIER` to its collection's holder. */
  base: number;
}

export const COLLECTIONS: readonly Collection[] = [
  { id: 'kitchen', name: 'The Kitchen', blurb: 'Copper, cast iron, and burnt sugar.' },
  { id: 'attic', name: 'The Attic', blurb: 'Dust, brass, and things that telescope.' },
  { id: 'letters', name: 'The Correspondence', blurb: 'Everyone kept everything.' },
  { id: 'vinyl', name: 'The Record Cabinet', blurb: 'Crackle, croon, and one bad poster.' },
  { id: 'garden', name: 'The Garden', blurb: 'Shears, seed tins, and a bird bath.' },
  { id: 'wardrobe', name: 'The Wardrobe', blurb: 'Camel wool and dancing shoes.' },
] as const;

export const ITEMS: readonly Item[] = [
  { id: 'kitchen-pot', name: 'Copper Stock Pot', collection: 'kitchen', base: 16 },
  { id: 'kitchen-plates', name: 'Willow-Pattern Plates', collection: 'kitchen', base: 18 },
  { id: 'kitchen-scales', name: 'Brass Kitchen Scales', collection: 'kitchen', base: 22 },

  { id: 'attic-telescope', name: 'Brass Telescope', collection: 'attic', base: 24 },
  { id: 'attic-trunk', name: 'Steamer Trunk', collection: 'attic', base: 14 },
  { id: 'attic-ornaments', name: 'Box of Ornaments', collection: 'attic', base: 16 },

  { id: 'letters-bundle', name: 'Bundle of Love Letters', collection: 'letters', base: 20 },
  { id: 'letters-pen', name: 'Fountain Pen', collection: 'letters', base: 18 },
  { id: 'letters-postcards', name: 'Postcard Album', collection: 'letters', base: 14 },

  { id: 'vinyl-jazz', name: 'Jazz LPs, First Pressing', collection: 'vinyl', base: 22 },
  { id: 'vinyl-gramophone', name: 'Gramophone', collection: 'vinyl', base: 26 },
  { id: 'vinyl-poster', name: 'Framed Tour Poster', collection: 'vinyl', base: 12 },

  { id: 'garden-shears', name: 'Rose Shears', collection: 'garden', base: 14 },
  { id: 'garden-bath', name: 'Stone Bird Bath', collection: 'garden', base: 20 },
  { id: 'garden-seeds', name: 'Seed Tin', collection: 'garden', base: 16 },

  { id: 'wardrobe-coat', name: 'Camel Hair Coat', collection: 'wardrobe', base: 22 },
  { id: 'wardrobe-pearls', name: 'Pearl Necklace', collection: 'wardrobe', base: 28 },
  { id: 'wardrobe-shoes', name: 'Dancing Shoes', collection: 'wardrobe', base: 16 },
] as const;

const ITEMS_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
const COLLECTIONS_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

export function getItem(id: string): Item {
  const item = ITEMS_BY_ID.get(id);
  if (!item) throw new Error(`Unknown item: ${id}`);
  return item;
}

export function getCollection(id: CollectionId): Collection {
  const collection = COLLECTIONS_BY_ID.get(id);
  if (!collection) throw new Error(`Unknown collection: ${id}`);
  return collection;
}

/** What this item is worth to a player holding `collection`. */
export function valueTo(item: Item, collection: CollectionId, multiplier: number): number {
  return item.collection === collection ? item.base * multiplier : item.base;
}
