function slugify(text) {
  return text.toLowerCase().split("/")[0]
    .replace(/[^\p{L}\p{N}]+/giu, "-").replace(/^-+|-+$/g, "");
}

function thCount(tableNode) {
  const thead = (tableNode.children || []).find((c) => c.tagName === "thead");
  if (!thead) return 0;
  return (thead.children || [])
    .filter((c) => c.tagName === "tr")
    .reduce((n, tr) => n + (tr.children || []).filter((c) => c.tagName === "th").length, 0);
}

/**
 * Sätteri hast plugin for the tricks (kombinasjoner) pages:
 * - all content images get lazy loading + async decoding
 * - tbody rows of trick tables (exactly 4 columns: name, difficulty,
 *   description, combo) get a stable id slugified from the trick name
 *   (first cell), so tricks can be deep-linked — e.g. /#kioskenstrøm
 *   (special-cased: any row mentioning "kiosken" gets that exact id)
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

        let id = "";
        if (ctx.textContent(node).toLowerCase().includes("kiosken")) {
          id = "kioskenstrøm";
        } else {
          const table = ctx.parent(tbody);
          if (!table || table.tagName !== "table" || thCount(table) !== 4) return;
          const firstTd = (node.children || []).find((c) => c.tagName === "td");
          if (!firstTd) return;
          id = slugify(ctx.textContent(firstTd));
        }
        if (id) {
          ctx.setProperty(node, "id", id);
        }
      }
    },
  },
};
