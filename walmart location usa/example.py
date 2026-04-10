"""
example.py

Demonstrates how to load and use walmart-stores.json (Python 3).

Run:
    python example.py
"""

import json
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. Load the data
# ---------------------------------------------------------------------------

file_path = Path(__file__).parent / "walmart-stores.json"
with open(file_path, encoding="utf-8") as f:
    stores = json.load(f)

print(f"Loaded {len(stores)} Walmart store entries.\n")

# ---------------------------------------------------------------------------
# 2. Print the first 3 entries
# ---------------------------------------------------------------------------

print("First 3 entries:")
for i, store in enumerate(stores[:3]):
    print(
        f"  [{i}] store_id={store['store_id']}  "
        f"zip={store['postal_code']}  "
        f"address={store['address']}"
    )
print()

# ---------------------------------------------------------------------------
# 3. Filter stores by state (looks for ', STATE ZIP' pattern in the address)
# ---------------------------------------------------------------------------

def filter_by_state(store_list: list[dict], state_abbr: str) -> list[dict]:
    """Return stores whose address contains the given two-letter state code."""
    pattern = re.compile(rf",\s*{re.escape(state_abbr)}\s+\d{{5}}", re.IGNORECASE)
    return [s for s in store_list if pattern.search(s.get("address", ""))]


texas_stores = filter_by_state(stores, "TX")
print(f"Stores in Texas (TX): {len(texas_stores)}")
if texas_stores:
    print("  First TX store:", texas_stores[0])
print()

# ---------------------------------------------------------------------------
# 4. Look up a store by store_id
# ---------------------------------------------------------------------------

def find_by_store_id(store_list: list[dict], store_id: str) -> dict | None:
    """Return the store entry matching the given store_id, or None."""
    return next((s for s in store_list if s["store_id"] == store_id), None)


found = find_by_store_id(stores, "1158")
if found:
    print("Found store 1158:", found)
else:
    print("Store 1158 not found.")
