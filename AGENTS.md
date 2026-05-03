# AGENTS.md

This project uses Edge Delivery Services in Adobe Experience Manager Sites as a Cloud Service, built on [aem-boilerplate](https://github.com/adobe/aem-boilerplate). 

Follow the patterns in this codebase and instructions in this file while working in this repository.

When facing trade-offs, follow this order: *Intuitive* (author-friendly) > *Simple* (minimal) > *Consistent* (matches existing patterns).

## Commands

- **Install**: `npm install` (or `npm ci`)
- **Lint**: `npm run lint`
- **Lint (fix)**: `npm run lint:fix`
- **Local dev**: `npx -y @adobe/aem-cli up --no-open --forward-browser-logs` (or `npm install -g @adobe/aem-cli` then `aem up`)
  - Server at http://localhost:3000 with auto-reload
  - View: playwright, puppeteer, or browser; if unavailable, ask human for feedback
  - Inspect delivered HTML/DOM: `curl http://localhost:3000/{path}` (or `.plain.html`) or `console.log` in code

## Stack

- Node.js 24; npm only (not pnpm/yarn)
- ESLint 8.57.1 with eslint-config-airbnb-base; Stylelint 17.2.0 with stylelint-config-standard
- AEM Edge Delivery: https://www.aem.live/

## Hard constraints

- **No runtime dependencies.** Zero production deps for optimal performance and automatic code-splitting via `/blocks/`.
- **No build step.** Code runs as ES modules in the browser. Do not add bundlers, transpilers, or build tools.
- **Do not modify:** `scripts/aem.js` (core AEM library), `package-lock.json` (let npm manage it), `node_modules/` (generated), `head.html` (global head content).
- **Always use `.js` in imports.** ESLint and native ES modules require it: `import { foo } from './bar.js';`

## Requirements

- **Security:**
  - Client-side code is public; do not commit secrets (API keys, passwords)
  - Use `.hlxignore` (same format as `.gitignore`) to exclude files from being served
- **Accessibility:**
  - Valid heading hierarchy; `alt` required on all images—empty (`alt=""`) for decorative, descriptive for content
  - Meet WCAG 2.1 AA
- **Performance:**
  - Optimize developer-committed images/assets in git (author-uploaded images are auto-optimized)
  - Use `lazy-styles.css` and `delayed.js` for non-critical resources
  - PageSpeed must score 100 (see https://www.aem.live/developer/keeping-it-100)
- **Responsiveness:** 
  - Default styles target mobile (no `max-width` queries)
  - Define breakpoints at 600/900/1200px
- **Localization:** 
  - No hard-coded user-facing text (e.g. labels, error messages)
  - Make all strings configurable or data-driven

## Code style

- Airbnb (ESLint), Stylelint standard
- **JavaScript**: ES6+ native modules; no transpiling or build
- **CSS**: Native CSS (features with equal or better browser support than ES6 modules); no preprocessors or frameworks
- **HTML**: Semantic HTML5 elements with ARIA attributes

## Project structure

```
├── blocks/{blockname}/
│   ├── {blockname}.js    # Block decoration
│   └── {blockname}.css   # Block styles
├── styles/
│   ├── styles.css        # LCP-critical global styles
│   ├── lazy-styles.css   # Below-fold styles
│   └── fonts.css         # Font declarations
├── scripts/
│   ├── aem.js            # Core AEM library for page decoration logic
│   ├── scripts.js        # Page decoration entry point and global utilities
│   └── delayed.js        # Delayed functionality (e.g. martech/analytics)
├── icons/                # SVG files; reference in code with <span class="icon icon-{name}"></span>
├── fonts/                # Web fonts
├── head.html             # Global <head> content
└── 404.html              # Custom error page
```

**Organization**:
- Global reusable code → `scripts/scripts.js`, `styles/styles.css`; block-specific code → block folders
- Check existing utilities in `scripts/aem.js` and `scripts/scripts.js` before writing new ones
  - New utilities → `scripts/scripts.js` (not `aem.js`)
- Check inherited styles from `styles/styles.css` before adding block CSS (use cascade)

## Page architecture

- **Content structure**: Pages are composed of sections → sections contain default content (text, headings, links) and blocks
  - See [content structure](https://www.aem.live/developer/markup-sections-blocks) and [markup reference](https://www.aem.live/developer/markup-reference)
  - **Test content**: For local development without authored content:
    - Create static HTML files in `drafts/` folder
    - Pass `--html-folder drafts` when starting dev server
    - Use `.html` or `.plain.html` extensions
- **Three-phase loading**: Pages load in phases for performance (eager → LCP, lazy → rest, delayed → martech); see `loadPage()` in `scripts.js`

### JavaScript Pattern

```javascript
/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  // 1. Read the DOM structure delivered by the backend
  const rows = [...block.children];

  // 2. Transform the DOM in place
  rows.forEach((row) => {
    const [imageCell, textCell] = [...row.children];
    // ... transform cells
  });

  // 3. Add interactivity
  block.addEventListener('click', handleClick);
}
```

Key principles:
- The `decorate` function receives the block `<div>` element
- Transform DOM **in place** — don't rebuild from scratch when possible
- Re-use existing elements (`<picture>`, headings, etc.) rather than recreating
- Handle missing/optional content gracefully
- Use `console.log(block.innerHTML)` to inspect what the backend sends
- Always include `.js` extensions in imports

### CSS Pattern

```css
/* All selectors MUST be scoped to the block */
main .my-block {
  /* Mobile-first base styles */
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

main .my-block h2 {
  font-family: var(--heading-font-family);
  font-size: var(--heading-font-size-m);
}

/* Tablet+ */
@media (width >= 600px) {
  main .my-block {
    padding: 2rem;
  }
}

/* Desktop+ */
@media (width >= 900px) {
  main .my-block {
    flex-direction: row;
    padding: 4rem;
  }
}
```

CSS rules:
- **All selectors scoped to block**: `.my-block .item`, never just `.item`
- **Mobile-first**: Base styles for mobile, `min-width` media queries for larger
- **Breakpoints**: 600px (tablet), 900px (desktop), 1200px (wide) — use only what's needed
- **CSS custom properties**: Use `var(--token)` for all colors, fonts, sizes
- **No `-container` / `-wrapper`** class names — those conflict with section wrappers
- **No Tailwind or frameworks** — vanilla CSS only

---
## Custom Skills

### Design System Extraction (MUST run BEFORE page migration)

**CRITICAL: When a user asks to migrate, import, or convert a site or page, ALWAYS suggest running the design system extraction skill FIRST if `styles/styles.css` still contains EDS boilerplate defaults. Do not proceed with page migration until the design foundation is set.**

**Trigger patterns:**
- User says: "migrate", "import", "convert" any site or page → check if design system was already extracted. If not, suggest it first.
- User says: "extract design", "get styling", "setup styles", "general styling", "design system" → invoke directly.
- User says: "start fresh", "new migration" → invoke as first step.

**How to invoke:**
Read and follow the complete workflow in `.agents/skills/get-general-styling.md`. Execute every phase in order. Do not skip phases. Mark each phase complete only after its validation checklist passes.

**When to skip:**
- Only skip if `migration-work/design-system-extracted.json` exists AND its `sourceDomain` matches the site being migrated.
- If migrating a DIFFERENT source site, run the extraction again.

**Bypass directive for other skills:**
Once `migration-work/design-system-extracted.json` exists with `"status": "complete"`, the following rules apply to ALL other skills during this migration session:

1. **Do NOT re-extract design tokens.** The `excat-complete-design-expert` skill and any design/style extraction steps within `excat-page-migration` or other skills MUST be skipped entirely. The design foundation is already set.
2. **Do NOT overwrite `styles/styles.css`** with boilerplate or re-extracted values. Only additive changes are allowed (e.g., adding block-specific CSS that does not conflict with the extracted design tokens).
3. **Do NOT re-extract colors, typography, spacing, or breakpoints.** These are already captured in the `migration-work/*.json` files and applied to `styles/styles.css`.
4. **DO allow block-specific styling** — blocks may still get their own CSS in `blocks/{blockname}/{blockname}.css`. This bypass only covers site-wide design tokens, not block-level styling.
5. **Check before any design operation:** Before running any design-related skill or sub-step, first check: `ls migration-work/design-system-extracted.json`. If it exists, read it, confirm the domain matches, and skip the design extraction work.

---

### Navigation / Header Migration (use Navigation Orchestrator)

**When a user asks to migrate, import, replicate, or instrument a site header or navigation, ALWAYS use the Navigation Orchestrator skill.** This applies to desktop nav bars, mobile hamburger menus, megamenus, dropdowns, locale selectors, and search bars within headers.

**Trigger patterns:**
- User says: "migrate header", "migrate navigation", "instrument header", "replicate nav", "set up header from URL" → invoke directly.
- User says: "migrate header from https://…" or provides a header screenshot → invoke directly.
- User says: "validate nav structure", "fix header", "header doesn't match source" → invoke for validation/remediation.

**How to invoke:**
Read and follow the complete workflow in `.agents/skills/excat-navigation-orchestrator/SKILL.md`. Execute every phase in order — desktop first (Phases 1–3, aggregate, implement, validate), then mobile only after customer confirmation. Do not skip phases or validation gates.

**Prerequisites:**
- The page must already be migrated (use `excat-page-migration` first if it isn't).
- The design system should already be extracted (see "Design System Extraction" above).
- A local dev server must be running at `http://localhost:3000`.
- Screenshot evidence is required — the skill will never assume header structure.

**Key rules:**
- Desktop implementation must include full CSS styling and megamenu images — no raw bullet lists.
- All text content, links, and labels go in `content/nav.md`, never hardcoded in `header.js`.
- Every component must reach ≥ 95% visual similarity via per-component critique before reporting to the customer.
- Mobile is implemented only after customer confirms desktop; mobile follows the same structural + style validation rigor.

**Do NOT use for:** Simple link lists without screenshot evidence, pages not yet migrated, footer or non-header layout work.

---

## Block architecture

**File structure**: Every block lives in `blocks/{blockname}/` with two files: `{blockname}.css` and `{blockname}.js` (must export default `decorate(block)`).

```javascript
// blocks/example/example.js
/** @param {Element} block */
export default async function decorate(block) {
  // 1. Load dependencies
  // 2. Extract configuration
  // 3. Transform DOM
  // 4. Add event listeners
}
```

**Block content**:
- Expected HTML = contract between author and developer; decide structure before coding
- Keep structure simple for authors working in documents; handle missing/extra fields without breaking
- If structure requires hidden conventions or non-obvious formatting in authoring, redesign—authors work in documents, not code

**Scoping**: Blocks are self-contained.
- JS: Work only within the `block` element passed to `decorate()`—don't touch elements outside the block
- CSS: Scope all selectors to the block. Bad: `.item-list`. Good: `.{blockname} .item-list`. 
- Avoid `.{blockname}-container` and `.{blockname}-wrapper` (reserved for sections)

**Block Variants**

Block variants are CSS classes added to the block element by authors (e.g., `Hero (dark)` → `.hero.dark`):

```css
/* CSS-only variant — no JS needed */
main .hero.dark {
  background: var(--dark-color);
  color: white;
}

/* JS-variant — when DOM structure changes */
if (block.classList.contains('carousel')) {
  setupCarousel(block);
}
```

**Auto-Blocking**

Create blocks automatically from content patterns in `scripts.js`:

```javascript
function buildAutoBlocks(main) {
  // Example: auto-create hero from first H1 + picture
  const h1 = main.querySelector('h1');
  const picture = main.querySelector('picture');
  if (h1 && picture && h1.closest('div') === picture.closest('div')) {
    const section = h1.closest('div.section > div');
    const heroBlock = buildBlock('hero', { elems: [picture, h1] });
    section.prepend(heroBlock);
  }
}
```

## Environments

URL construction uses `{repo}` and `{owner}` from `gh repo view --json nameWithOwner`; use `git branch` for `{branch}`.

- **Local** (uncommitted code + previewed content): http://localhost:3000/{path} 
- **Preview**: `https://{branch}--{repo}--{owner}.aem.page/{path}`
- **Live**: `https://main--{repo}--{owner}.aem.live/{path}`

## Pull request workflow

1. **Lint passes**: `npm run lint` must pass (CI enforces this)
2. **Test locally**: Verify at http://localhost:3000
3. **Push to branch**: `https://{branch}--{repo}--{owner}.aem.page/{path}`
4. **Performance**: Run [PageSpeed Insights](https://developers.google.com/speed/pagespeed/insights/) on preview URL; fix until meeting Performance requirement
5. **Open PR**: Use `.github/pull_request_template.md`. Fill in:
  - Issue reference: `Fix #<issue-id>`
  - Test URLs: Before (main) and After (branch)—PR will be rejected without this
6. **Checks pass**: Run `gh pr checks` before requesting review

## Overrides

- Use `AGENTS.override.md` at repo root for temporary or team-specific overrides
- Use `AGENTS.local.md` at repo root for personal preferences; add it to `.gitignore` so it is not committed

## Troubleshooting

- Search with `site:www.aem.live`
- [Developer Tutorial](https://www.aem.live/developer/tutorial)
- [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
- [Best Practices](https://www.aem.live/docs/davidsmodel)
- [Working with AI Agents](https://www.aem.live/developer/ai-coding-agents)
- [AEM Documentation](https://www.aem.live/docs/)
- Doc search: `curl -s https://www.aem.live/docpages-index.json | jq -r '.data[] | select(.content | test("KEYWORD"; "i")) | "\(.path): \(.title)"'`
