(function () {
  'use strict';

  function initTricks() {
    const mainContent = document.querySelector('.rich-text');
    if (!mainContent) return;

    // Find all trick tables (4-column tables: Name, Difficulty, Description, Combo)
    const allTables = Array.from(mainContent.querySelectorAll('table'));
    const trickTables = allTables.filter((table) => {
      const ths = table.querySelectorAll('th');
      return ths.length === 4;
    });

    if (trickTables.length === 0) return;

    const isEn = document.documentElement.lang === 'en';

    const i18n = {
      no: {
        placeholder: 'Søk i triks…',
        ariaSearch: 'Søk i triks',
        clear: 'Nullstill',
        all: 'Alle',
        easy: 'Enkle (0–3)',
        medium: 'Middels (4–6)',
        hard: 'Vanskelige (7–10)',
        showing: (n, total) => `Viser ${n} av ${total} triks`,
        noResults: (q) => `Ingen triks funnet for «${q}»`,
      },
      en: {
        placeholder: 'Search tricks…',
        ariaSearch: 'Search tricks',
        clear: 'Clear',
        all: 'All',
        easy: 'Easy (0–3)',
        medium: 'Medium (4–6)',
        hard: 'Hard (7–10)',
        showing: (n, total) => `Showing ${n} of ${total} tricks`,
        noResults: (q) => `No tricks found for "${q}"`,
      },
    };

    const t = isEn ? i18n.en : i18n.no;

    // Sticky table headers for mobile
    trickTables.forEach((table) => {
      table.classList.add('tricks-table');
      const thead = table.querySelector('thead');
      if (thead) {
        thead.classList.add('sticky', 'top-14', 'z-10', 'bg-slate-50', 'shadow-xs');
      }
    });

    // Extract trick rows and metadata
    const allRows = [];
    trickTables.forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      rows.forEach((row) => {
        const tds = row.querySelectorAll('td');
        if (tds.length >= 3) {
          const name = tds[0].textContent.trim();
          const diffVal = parseInt(tds[1].textContent.trim(), 10);
          const desc = tds[2].textContent.trim();
          allRows.push({
            row,
            table,
            name: name.toLowerCase(),
            desc: desc.toLowerCase(),
            diff: isNaN(diffVal) ? -1 : diffVal,
          });
        }
      });
    });

    const totalCount = allRows.length;

    // Create Sticky Controls Container
    const controls = document.createElement('div');
    controls.className =
      'tricks-controls sticky top-0 z-20 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-3 mb-6 flex flex-wrap items-center justify-between gap-3 text-sm';

    // Left group: Search input & Chips
    const leftGroup = document.createElement('div');
    leftGroup.className = 'flex flex-wrap items-center gap-3 w-full lg:w-auto';

    // Search Input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'relative flex-1 sm:flex-none';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = t.placeholder;
    searchInput.setAttribute('aria-label', t.ariaSearch);
    searchInput.className =
      'w-full sm:w-64 px-3 py-1.5 border border-slate-300 rounded-md text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600';

    searchWrapper.appendChild(searchInput);
    leftGroup.appendChild(searchWrapper);

    // Filter Chips
    const chipGroup = document.createElement('div');
    chipGroup.className = 'flex flex-wrap items-center gap-1.5';
    chipGroup.setAttribute('role', 'group');
    chipGroup.setAttribute('aria-label', 'Vanskelegheitsgrad');

    const chips = [
      { id: 'all', label: t.all, min: 0, max: 10 },
      { id: 'easy', label: t.easy, min: 0, max: 3 },
      { id: 'medium', label: t.medium, min: 4, max: 6 },
      { id: 'hard', label: t.hard, min: 7, max: 10 },
    ];

    let currentChip = 'all';
    const chipButtons = [];

    chips.forEach((chip) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = chip.label;
      btn.setAttribute('aria-pressed', chip.id === 'all' ? 'true' : 'false');
      btn.className =
        chip.id === 'all'
          ? 'inline-flex items-center min-h-[44px] px-2.5 py-1 text-xs font-medium rounded-full bg-red-600 text-white transition-colors cursor-pointer'
          : 'inline-flex items-center min-h-[44px] px-2.5 py-1 text-xs font-medium rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors cursor-pointer';

      btn.addEventListener('click', () => {
        currentChip = chip.id;
        chipButtons.forEach((b, idx) => {
          const isSelected = chips[idx].id === currentChip;
          b.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
          b.className = isSelected
            ? 'inline-flex items-center min-h-[44px] px-2.5 py-1 text-xs font-medium rounded-full bg-red-600 text-white transition-colors cursor-pointer'
            : 'inline-flex items-center min-h-[44px] px-2.5 py-1 text-xs font-medium rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors cursor-pointer';
        });
        filterRows();
      });

      chipButtons.push(btn);
      chipGroup.appendChild(btn);
    });

    leftGroup.appendChild(chipGroup);
    controls.appendChild(leftGroup);

    // Right group: Count indicator & Clear button
    const rightGroup = document.createElement('div');
    rightGroup.className = 'flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end';

    const countEl = document.createElement('p');
    countEl.setAttribute('aria-live', 'polite');
    countEl.className = 'text-xs text-slate-600 font-medium';
    countEl.textContent = t.showing(totalCount, totalCount);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = t.clear;
    clearBtn.className =
      'hidden text-xs text-red-600 hover:text-red-700 underline font-medium cursor-pointer';

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      currentChip = 'all';
      chipButtons.forEach((b, idx) => {
        const isSelected = chips[idx].id === 'all';
        b.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        b.className = isSelected
          ? 'px-2.5 py-1 text-xs font-medium rounded-full bg-red-600 text-white transition-colors cursor-pointer'
          : 'px-2.5 py-1 text-xs font-medium rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors cursor-pointer';
      });
      filterRows();
    });

    rightGroup.appendChild(countEl);
    rightGroup.appendChild(clearBtn);
    controls.appendChild(rightGroup);

    // Insert controls before the first trick table
    const firstTrickTable = trickTables[0];
    firstTrickTable.parentNode.insertBefore(controls, firstTrickTable);

    // Filter Logic
    let debounceTimer;

    function filterRows() {
      const query = searchInput.value.trim().toLowerCase();
      const selectedChipObj = chips.find((c) => c.id === currentChip);
      const minDiff = selectedChipObj.min;
      const maxDiff = selectedChipObj.max;

      let visibleCount = 0;

      allRows.forEach((item) => {
        const matchesQuery = !query || item.name.includes(query) || item.desc.includes(query);
        const matchesDiff = item.diff >= minDiff && item.diff <= maxDiff;

        const isVisible = matchesQuery && matchesDiff;
        item.row.hidden = !isVisible;
        if (isVisible) visibleCount++;
      });

      // Update Section Headings visibility
      trickTables.forEach((table) => {
        const visibleTableRows = table.querySelectorAll('tbody tr:not([hidden])');
        const prevH2 = table.previousElementSibling;

        if (visibleTableRows.length === 0) {
          table.hidden = true;
          if (prevH2 && prevH2.tagName === 'H2') prevH2.hidden = true;
        } else {
          table.hidden = false;
          if (prevH2 && prevH2.tagName === 'H2') prevH2.hidden = false;
        }
      });

      // Update Count / Status message
      if (visibleCount === 0 && query) {
        countEl.textContent = t.noResults(query);
      } else {
        countEl.textContent = t.showing(visibleCount, totalCount);
      }

      // Show/Hide Clear button
      if (query || currentChip !== 'all') {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
    }

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(filterRows, 150);
    });

    // Handle initial hash jump if present
    if (window.location.hash) {
      const targetId = window.location.hash.substring(1);
      const targetRow = document.getElementById(targetId);
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTricks);
  } else {
    initTricks();
  }
})();
