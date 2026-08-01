function slugify(text) {
  return text.toLowerCase().split("/")[0]
    .replace(/[^\p{L}\p{N}]+/giu, "-").replace(/^-+|-+$/g, "");
}

function tableHeaders(tableNode, ctx) {
  const thead = (tableNode.children || []).find((c) => c.tagName === "thead");
  const row = (thead?.children || []).find((c) => c.tagName === "tr");
  if (!row) return [];
  return (row.children || [])
    .filter((c) => c.tagName === "th")
    .map((th) => ctx.textContent(th).trim().toLowerCase());
}

function matchesHeaders(actual, expected) {
  return actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

/**
 * Sätteri hast plugin for the tricks (kombinasjoner) pages:
 * - all content images get lazy loading + async decoding
 * - tbody rows of the specifically headed trick tables get a stable id
 *   slugified from the trick name
 *   (first cell), while the difficulty-table Kioskenstrøm row keeps the
 *   historic /#kioskenstrøm deep link used by the 404 page
 */
export const satteriRehypeTricks = {
  name: "rehype-tricks",
  element: {
    filter: ["img", "tr"],
    visit(node, ctx) {
      if (node.tagName === "img") {
        ctx.setProperty(node, "loading", "lazy");
        ctx.setProperty(node, "decoding", "async");
      }
      if (node.tagName === "tr") {
        const tbody = ctx.parent(node);
        if (!tbody || tbody.tagName !== "tbody") return;

        const table = ctx.parent(tbody);
        if (!table || table.tagName !== "table") return;
        const headers = tableHeaders(table, ctx);
        const isTrickTable =
          matchesHeaders(headers, ["trekk", "vanskelighetsgrad", "forklåring", "kombo"]) ||
          matchesHeaders(headers, ["trick", "difficulty", "description", "combo"]);
        const isDifficultyTable =
          matchesHeaders(headers, ["grad", "definisjon", "eksempel"]) ||
          matchesHeaders(headers, ["level", "definition", "example"]);

        // Preserve the historic deep link used by the 404 page, but only in
        // the known difficulty table instead of every table on the site.
        if (isDifficultyTable && ctx.textContent(node).toLowerCase().includes("kioskenstrøm")) {
          ctx.setProperty(node, "id", "kioskenstrøm");
          return;
        }
        if (!isTrickTable) return;

        const firstTd = (node.children || []).find((c) => c.tagName === "td");
        if (!firstTd) return;
        const id = slugify(ctx.textContent(firstTd));
        if (id) {
          ctx.setProperty(node, "id", id);
        }
      }
    },
  },
};
