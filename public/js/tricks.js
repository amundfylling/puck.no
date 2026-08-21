(function () {
  'use strict';

  const normalize = (value) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase()
      .trim();

  function initCatalogue(root) {
    const search = root.querySelector('[data-trick-search]');
    const items = Array.from(root.querySelectorAll('[data-trick-item]'));
    const count = root.querySelector('[data-result-count]');
    const label = root.querySelector('[data-result-label]');
    const empty = root.querySelector('[data-empty-state]');
    const clearButtons = Array.from(root.querySelectorAll('[data-clear-filters]'));
    const playerButtons = Array.from(root.querySelectorAll('[data-player]'));
    const difficultyButtons = Array.from(root.querySelectorAll('button[data-difficulty]'));
    if (!search || !count || !label || !empty || items.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const state = {
      player: playerButtons.some((button) => button.dataset.player === params.get('player'))
        ? params.get('player')
        : 'all',
      difficulty: difficultyButtons.some((button) => button.dataset.difficulty === params.get('difficulty'))
        ? params.get('difficulty')
        : 'all',
    };
    search.value = params.get('q') || '';

    function syncPressed(buttons, key) {
      buttons.forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset[key] === state[key] ? 'true' : 'false');
      });
    }

    function syncUrl() {
      const next = new URLSearchParams();
      const query = search.value.trim();
      if (query) next.set('q', query);
      if (state.player !== 'all') next.set('player', state.player);
      if (state.difficulty !== 'all') next.set('difficulty', state.difficulty);
      const queryString = next.toString();
      history.replaceState(null, '', `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`);
    }

    function filter() {
      const query = normalize(search.value);
      let visible = 0;

      items.forEach((item) => {
        const matchesSearch = !query || normalize(item.dataset.search || '').includes(query);
        const matchesPlayer = state.player === 'all' || (item.dataset.players || '').split(' ').includes(state.player);
        const matchesDifficulty = state.difficulty === 'all' || item.dataset.difficulty === state.difficulty;
        item.hidden = !(matchesSearch && matchesPlayer && matchesDifficulty);
        if (!item.hidden) visible += 1;
      });

      count.textContent = String(visible);
      label.textContent = visible === 1 ? label.dataset.one : label.dataset.many;
      empty.classList.toggle('hidden', visible !== 0);
      clearButtons.forEach((button, index) => {
        if (index === 0) {
          button.classList.toggle('hidden', !query && state.player === 'all' && state.difficulty === 'all');
          button.classList.toggle('inline-flex', Boolean(query) || state.player !== 'all' || state.difficulty !== 'all');
        }
      });
      syncUrl();
    }

    let searchTimer;
    search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(filter, 120);
    });

    playerButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.player = button.dataset.player;
        syncPressed(playerButtons, 'player');
        filter();
      });
    });

    difficultyButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.difficulty = button.dataset.difficulty;
        syncPressed(difficultyButtons, 'difficulty');
        filter();
      });
    });

    clearButtons.forEach((button) => {
      button.addEventListener('click', () => {
        search.value = '';
        state.player = 'all';
        state.difficulty = 'all';
        syncPressed(playerButtons, 'player');
        syncPressed(difficultyButtons, 'difficulty');
        filter();
        search.focus();
      });
    });

    syncPressed(playerButtons, 'player');
    syncPressed(difficultyButtons, 'difficulty');
    filter();
  }

  function init() {
    document.querySelectorAll('[data-trick-catalogue]').forEach(initCatalogue);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
