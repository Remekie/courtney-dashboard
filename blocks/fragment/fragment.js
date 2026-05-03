/*
 * Fragment Block
 * Include content on a page as a fragment.
 * https://www.aem.live/developer/block-collection/fragment
 */

// eslint-disable-next-line import/no-cycle
import {
  decorateMain,
  ensureDOMPurify,
  moveInstrumentation,
} from '../../scripts/scripts.js';

import {
  loadSections,
  DOMPURIFY,
} from '../../scripts/aem.js';

/**
 * Loads a fragment.
 * @param {string} path The path to the fragment
 * @returns {Promise<HTMLElement>} The root element of the fragment
 */
export async function loadFragment(path) {
  if (path && path.startsWith('/') && !path.startsWith('//')) {
    await ensureDOMPurify();
    const resp = await fetch(`${path}.plain.html`);
    if (resp.ok) {
      const main = document.createElement('main');
      main.innerHTML = window.DOMPurify.sanitize(await resp.text(), DOMPURIFY);

      // reset base path for media to fragment base (whitelist attr to avoid prototype pollution)
      const resetAttributeBase = (tag, attr) => {
        if (attr !== 'src' && attr !== 'srcset') return;
        main.querySelectorAll(`${tag}[${attr}^="./media_"]`).forEach((elem) => {
          const { href } = new URL(elem.getAttribute(attr), new URL(path, window.location));
          if (attr === 'src') elem.src = href;
          else if (attr === 'srcset') elem.srcset = href;
        });
      };
      resetAttributeBase('img', 'src');
      resetAttributeBase('source', 'srcset');

      decorateMain(main);
      await loadSections(main);
      return main;
    }
  }
  return null;
}

/**
 * @param {Element} block
 */
export default async function decorate(block) {
  const link = block.querySelector('a');
  const path = link ? link.getAttribute('href') : block.textContent.trim();
  const fragment = await loadFragment(path);
  if (fragment) {
    const fragmentSection = fragment.querySelector(':scope .section');
    if (fragmentSection) {
      block.closest('.section').classList.add(...fragmentSection.classList);
      moveInstrumentation(block, block.parentElement);
      block.closest('.fragment').replaceWith(...fragment.childNodes);
    }
  }
}
