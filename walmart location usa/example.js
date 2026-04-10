/**
 * example.js
 *
 * Demonstrates how to load and use walmart-stores.json (Node.js, ES modules).
 *
 * Run:
 *   node example.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. Load the data
// ---------------------------------------------------------------------------

const filePath = join(__dirname, 'walmart-stores.json');
const stores = JSON.parse(readFileSync(filePath, 'utf8'));

console.log(`Loaded ${stores.length} Walmart store entries.\n`);

// ---------------------------------------------------------------------------
// 2. Print the first 3 entries
// ---------------------------------------------------------------------------

console.log('First 3 entries:');
stores.slice(0, 3).forEach((store, i) => {
  console.log(`  [${i}] store_id=${store.store_id}  zip=${store.postal_code}  address=${store.address}`);
});
console.log();

// ---------------------------------------------------------------------------
// 3. Filter stores by state (using postal-code prefix is unreliable;
//    this example assumes the address string contains the two-letter state)
// ---------------------------------------------------------------------------

function filterByState(storeList, stateAbbr) {
  const pattern = new RegExp(`,\\s*${stateAbbr}\\s+\\d{5}`, 'i');
  return storeList.filter(s => pattern.test(s.address));
}

const texasStores = filterByState(stores, 'TX');
console.log(`Stores in Texas (TX): ${texasStores.length}`);
if (texasStores.length > 0) {
  console.log('  First TX store:', texasStores[0]);
}
console.log();

// ---------------------------------------------------------------------------
// 4. Look up a store by store_id
// ---------------------------------------------------------------------------

function findByStoreId(storeList, storeId) {
  return storeList.find(s => s.store_id === String(storeId)) || null;
}

const found = findByStoreId(stores, '1158');
if (found) {
  console.log('Found store 1158:', found);
} else {
  console.log('Store 1158 not found.');
}
