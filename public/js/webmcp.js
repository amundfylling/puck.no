/** Read-only WebMCP tools for browsers implementing the experimental API. */
(() => {
  const modelContext = document.modelContext ?? navigator.modelContext;
  if (!modelContext?.registerTool) return;

  const controller = new AbortController();
  const normalize = (value, max = 20_000) =>
    String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  const tools = [
    {
      name: 'read-current-puck-page',
      title: 'Read current puck.no page',
      description: 'Return the title, language, canonical URL, readable public content and relevant links from the current puck.no page.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute() {
        const main = document.querySelector('main');
        const links = [...(main?.querySelectorAll('a[href]') ?? [])].slice(0, 100).map((link) => ({
          text: normalize(link.textContent, 300),
          url: new URL(link.getAttribute('href'), location.href).href,
        }));
        return {
          title: document.title,
          language: document.documentElement.lang,
          url: document.querySelector('link[rel="canonical"]')?.href ?? location.href,
          content: normalize(main?.innerText),
          links,
        };
      },
    },
    {
      name: 'find-table-hockey-events',
      title: 'Find NBHF tournaments',
      description: 'Return public NBHF tournament links and summaries from the Norwegian or English puck.no tournament index.',
      inputSchema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            enum: ['no', 'en'],
            description: 'Use no for Norwegian or en for English.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ language = 'no' } = {}) {
        const indexPath = language === 'en' ? '/en/turneringer/' : '/turneringer/';
        const response = await fetch(indexPath, { headers: { Accept: 'text/html' } });
        if (!response.ok) throw new Error(`Tournament index returned HTTP ${response.status}`);
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        const prefix = language === 'en' ? '/en/turneringer/' : '/turneringer/';
        const seen = new Set();
        const events = [];
        for (const link of page.querySelectorAll(`main a[href^="${prefix}"]`)) {
          const path = new URL(link.getAttribute('href'), location.origin).pathname;
          if (path === prefix || seen.has(path)) continue;
          seen.add(path);
          const container = link.closest('article, li, section') ?? link.parentElement;
          events.push({
            name: normalize(link.textContent, 300),
            url: new URL(path, location.origin).href,
            summary: normalize(container?.innerText, 1_500),
          });
        }
        return { language, events };
      },
    },
  ];

  for (const tool of tools) {
    Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal })).catch(() => {});
  }
  addEventListener('pagehide', () => controller.abort(), { once: true });
})();
