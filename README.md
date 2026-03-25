# GitHub Markdown Rendered Diff Bookmarklet

A bookmarklet that adds a **"Show Rendered Diff"** button to GitHub diff pages, letting you toggle between the raw code diff and a rendered markdown view for `.md` files. Additions are highlighted in green, deletions in red, with word-level change highlighting.

## Install

1. Copy the entire contents of [`dist/bookmarklet.min.js`](dist/bookmarklet.min.js) (it starts with `javascript:`)
2. Create a new bookmark in your browser
3. Paste the copied code as the bookmark's **URL**
4. Navigate to any GitHub diff page containing `.md` files and click the bookmark

> **Why a bookmarklet?** GitHub's Content Security Policy blocks external scripts and fetches to third-party CDNs. A bookmarklet runs as a `javascript:` URL in the page context, bypassing CSP restrictions. The markdown parser ([snarkdown](https://github.com/developit/snarkdown)) is bundled inline so no external requests are needed.

**_Best used with the browsers Bookmark Bar/toolbar, if you don't mind losing the vertical space, usually found under the bookmarks menu_**
<img width="907" height="329" alt="image" src="https://github.com/user-attachments/assets/d0568f6a-58a2-4fbb-b105-58388f045425" />


## Features

- **Rendered markdown diff** — headings, bold, italic, links, images, lists, blockquotes, code blocks, inline code, horizontal rules
- **Pipe tables** — converted to styled HTML tables, with support for escaped pipes inside backtick code, HTML formatting in cells, and separate tables from blank-line-separated blocks
- **Unified and split view** — detects GitHub's diff layout and renders accordingly; split view aligns context sections horizontally between old/new panes
- **Dark mode** — respects GitHub's `data-color-mode` theme setting
- **Word-level highlighting** — changed words within a line are highlighted more strongly using LCS-based diffing
- **Code block styling** — fenced code blocks and inline code get a subtle background, matching GitHub's style
- **Dual GitHub UI support** — works on both the classic (logged-out) UI and the React-based (logged-in) UI
- **Works across page types** — PR file changes, branch/tag compare pages, and commit diffs
- **Toggle button** — "Show Rendered Diff" / "Show Code Diff" button added to each `.md` file header
- **Idempotent** — running the bookmarklet multiple times won't duplicate buttons or views
- **~14 KB** — snarkdown bundled inline, minified with terser

## Supported Page Types

| Page type | Logged in | Logged out |
|-----------|-----------|------------|
| PR changes (`/pull/N/files`) | Unified + Split | N/A |
| Compare (`/compare/A...B`) | Unified + Split | Unified + Split |
| Commit diff (`/commit/SHA`) | Unified + Split | Unified + Split |

## Limitations

- **snarkdown is minimal** — it does not support nested lists, task checkboxes, footnotes, or definition lists. These will render as plain text or malformed HTML.
- **Images are not loaded** — `![alt](url)` renders as `<img>` tags but GitHub's CSP blocks most external image sources in the diff context.
- **Large diffs** — very large files may be slow to parse and render, since all processing happens client-side in a single pass.
- **Collapsed file diffs** — if GitHub collapses a large diff ("Load diff" button), the bookmarklet can only process what is visible in the DOM. Expand the diff first, then run the bookmarklet again.
- **GitHub UI changes** — this bookmarklet relies on specific CSS classes and DOM structure. GitHub updates may break detection; the dual-UI approach (classic + React selectors) mitigates this.

## Development

```bash
npm install
npm run build        # builds dist/bookmarklet.min.js
npm test             # runs Playwright tests (30 tests across 4 page types)
npm run test:headed  # runs tests with visible browser
```

The build script (`scripts/build-bookmarklet.js`) concatenates snarkdown with `src/bookmarklet.js`, minifies with terser, and prepends `javascript:`.

## License

MIT
