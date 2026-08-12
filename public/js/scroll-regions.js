(function () {
  'use strict';

  function initScrollRegions() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('.scroll-region').forEach((region) => {
      region.addEventListener('keydown', (event) => {
        if (event.target !== region || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
          return;
        }
        if (region.scrollWidth <= region.clientWidth) return;

        event.preventDefault();
        region.scrollBy({
          left: (event.key === 'ArrowRight' ? 1 : -1) * Math.max(80, region.clientWidth * 0.75),
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollRegions);
  } else {
    initScrollRegions();
  }
})();
