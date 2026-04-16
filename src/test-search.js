/**
 * Regression test for createUnifiedIndex deduplication.
 * Run: node src/test-search.js
 *
 * Guards against the bug where title-based dedup silently dropped
 * API playlists whose name matched a DOM row (e.g. "Favorites").
 */

const MiniSearch = require("./vendor/minisearch.js");

const BM25_SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: 0.2,
  combineWith: "OR",
  weights: { fuzzy: 0.1, prefix: 0.75 },
};

function normalizeText(value) {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Mimics createUnifiedIndex from content.js */
function createUnifiedIndex(domRows, apiPlaylists) {
  const index = new MiniSearch({
    fields: ["text"],
    storeFields: ["source", "ref"],
    searchOptions: BM25_SEARCH_OPTIONS,
  });

  const docs = [];

  domRows.forEach((row, i) => {
    docs.push({ id: `dom:${i}`, text: normalizeText(row.title), source: "dom", ref: String(i) });
  });

  if (apiPlaylists?.length) {
    const domIds = new Set(domRows.map((r) => r.id).filter(Boolean));
    apiPlaylists.forEach((pl) => {
      if (domIds.has(pl.id)) return;
      docs.push({ id: `api:${pl.id}`, text: normalizeText(pl.title), source: "api", ref: pl.id });
    });
  }

  index.addAll(docs);
  return index;
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

// --- Test: exact-match API playlist is NOT dropped ---
{
  const dom = [{ id: "PL_abc", title: "Favorites" }];
  const api = [
    { id: "PL_abc", title: "Favorites" },   // same ID as DOM — should be deduped
    { id: "PL_xyz", title: "Favorites" },   // different ID, same title — must NOT be dropped
    { id: "PL_other", title: "Rock Favorites Mix" },
  ];

  const idx = createUnifiedIndex(dom, api);
  const results = idx.search("favorites", BM25_SEARCH_OPTIONS);
  const refs = results.map((r) => r.ref);

  assert(refs.includes("0"), "DOM 'Favorites' row should appear in results");
  assert(refs.includes("PL_xyz"), "API 'Favorites' with different ID must not be deduped");
  assert(!refs.includes("PL_abc"), "API playlist with same ID as DOM should be deduped");
  assert(refs.includes("PL_other"), "API 'Rock Favorites Mix' should appear");
}

// --- Test: API-only playlist appears when not in DOM at all ---
{
  const dom = [{ id: "PL_111", title: "Cooking Videos" }];
  const api = [{ id: "PL_222", title: "Favorites" }];

  const idx = createUnifiedIndex(dom, api);
  const results = idx.search("favorites", BM25_SEARCH_OPTIONS);

  assert(results.some((r) => r.ref === "PL_222"), "API-only 'Favorites' must appear in results");
  assert(!results.some((r) => r.ref === "0"), "'Cooking Videos' should not match 'favorites'");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
