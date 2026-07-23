import { visit } from "unist-util-visit";

function textOf(node) {
  let out = "";
  visit(node, "text", (t) => { out += t.value; });
  return out;
}

function slugify(text) {
  return text.toLowerCase().split("/")[0]
    .replace(/[^a-zæøå0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

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
        const parent = ctx.parent(node);
        if (parent && parent.tagName === "tbody") {
          const text = ctx.textContent(node);
          let id = "";
          if (text.toLowerCase().includes("kiosken")) {
            id = "kioskenstrøm";
          } else {
            id = slugify(text);
          }
          if (id) {
            ctx.setProperty(node, "id", id);
          }
        }
      }
    },
  },
};

export function rehypeTricks() {
  return (tree) => {
    visit(tree, "element", (node, _i, parent) => {
      if (node.tagName === "img" && node.properties) {
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
      }
      if (node.tagName === "tr" && parent && parent.tagName === "tbody") {
        const first = (node.children || []).find((c) => c.tagName === "td");
        const text = first ? textOf(first) : "";
        const id = text.toLowerCase().includes("kiosken") ? "kioskenstrøm" : (first ? slugify(text) : "");
        if (id) node.properties = { ...(node.properties || {}), id };
      }
    });
  };
}

export default rehypeTricks;
