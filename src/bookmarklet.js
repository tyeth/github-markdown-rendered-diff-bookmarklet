/**
 * GitHub Markdown Rendered Diff Bookmarklet
 *
 * Augments GitHub pull request diff pages with a rendered markdown viewer
 * for any .md files. Shows changed content with green/red banding and
 * supports both inline (unified) and split (side-by-side) diff views.
 * A toggle button on each markdown diff file lets you switch between the
 * original code diff and the rendered diff.
 *
 * Usage: paste the contents of this file (wrapped in `javascript:(function(){...})();`)
 * into a browser bookmark's URL field.
 */
(function () {
  'use strict';

  var MARKED_CDN = 'https://cdn.jsdelivr.net/npm/marked@4/marked.min.js';

  /* ------------------------------------------------------------------ */
  /* Bootstrap — load marked.js from CDN if not already present          */
  /* ------------------------------------------------------------------ */

  function init() {
    if (typeof window.marked !== 'undefined') {
      augmentPage();
    } else {
      var script = document.createElement('script');
      script.src = MARKED_CDN;
      script.onload = augmentPage;
      script.onerror = function () {
        console.error('[MD Diff] Failed to load marked.js from ' + MARKED_CDN);
      };
      document.head.appendChild(script);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Diff table parsing                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Returns the semantic type of a single `.blob-code` cell.
   * @param {Element} cell
   * @returns {'add'|'delete'|'context'|null}
   */
  function getCellType(cell) {
    if (cell.classList.contains('blob-code-addition')) return 'add';
    if (cell.classList.contains('blob-code-deletion')) return 'delete';
    if (cell.classList.contains('blob-code-context')) return 'context';
    return null;
  }

  /**
   * Extracts the raw markdown text from a `.blob-code` cell.
   *
   * Modern GitHub sets `data-code-marker` on `.blob-code-inner` and the text
   * content is already the bare code without the +/- prefix.
   * Older GitHub embeds the +/- prefix in the text content directly.
   *
   * @param {Element} cell
   * @returns {string}
   */
  function getCellContent(cell) {
    var inner = cell.querySelector('.blob-code-inner');
    if (!inner) return '';

    var text = inner.textContent;

    // Modern GitHub: data-code-marker is present, text is already clean
    if (inner.hasAttribute('data-code-marker')) {
      return text;
    }

    // Older GitHub: strip leading +/- /space marker if present
    if (text.length > 0 && (text[0] === '+' || text[0] === '-' || text[0] === ' ')) {
      return text.slice(1);
    }

    return text;
  }

  /**
   * Parses a diff `<table>` and returns an ordered array of line objects.
   *
   * Handles both inline (unified) and split (side-by-side) diff views.
   * In split view, context lines appear twice (once per side); only the
   * first occurrence is emitted to avoid duplication.
   *
   * @param {HTMLTableElement} table
   * @returns {Array<{type: 'add'|'delete'|'context', content: string}>}
   */
  function parseDiffTable(table) {
    var lines = [];

    var rows = table.querySelectorAll('tbody tr');
    rows.forEach(function (row) {
      var codeCells = Array.prototype.slice.call(row.querySelectorAll('.blob-code'));

      // Skip hunk-header rows (@@ … @@)
      if (codeCells.length === 0) return;
      if (row.classList.contains('js-expandable-line')) return;

      var contextSeenInRow = false;

      codeCells.forEach(function (cell) {
        var type = getCellType(cell);
        if (!type) return;

        // In split view, both halves of an unchanged line are context —
        // emit only the first to avoid duplicating context content.
        if (type === 'context') {
          if (contextSeenInRow) return;
          contextSeenInRow = true;
        }

        var content = getCellContent(cell);

        // In split view, cells with no content on one side are pure visual
        // padding (e.g. the left-side cell of a lines-only-added row).
        // We skip them for add/delete types to avoid injecting empty chunks.
        // Context cells that are blank ARE preserved because they represent
        // genuine blank lines in the unchanged markdown content.
        if (content.trim() === '' && type !== 'context') return;

        lines.push({ type: type, content: content });
      });
    });

    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* Rendered diff view creation                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Groups consecutive diff lines that share the same type into chunks.
   *
   * @param {Array<{type: string, content: string}>} lines
   * @returns {Array<{type: string, lines: string[]}>}
   */
  function buildChunks(lines) {
    var chunks = [];
    var current = null;

    lines.forEach(function (line) {
      if (!current || current.type !== line.type) {
        current = { type: line.type, lines: [] };
        chunks.push(current);
      }
      current.lines.push(line.content);
    });

    return chunks;
  }

  /**
   * Renders a single chunk (group of same-type lines) as an HTML element.
   *
   * @param {{type: string, lines: string[]}} chunk
   * @returns {HTMLElement}
   */
  function renderChunk(chunk) {
    var markdown = chunk.lines.join('\n');
    var html = window.marked.parse(markdown);

    var div = document.createElement('div');
    div.className = 'bookmarklet-diff-chunk bookmarklet-diff-chunk--' + chunk.type;
    div.innerHTML = html;

    if (chunk.type === 'add') {
      div.style.backgroundColor = '#e6ffed';
      div.style.borderLeft = '4px solid #22863a';
      div.style.paddingLeft = '8px';
      div.style.margin = '2px 0';
    } else if (chunk.type === 'delete') {
      div.style.backgroundColor = '#ffeef0';
      div.style.borderLeft = '4px solid #cb2431';
      div.style.paddingLeft = '8px';
      div.style.margin = '2px 0';
    } else {
      div.style.paddingLeft = '12px';
      div.style.margin = '2px 0';
    }

    return div;
  }

  /**
   * Builds the complete rendered-diff container from an array of diff lines.
   *
   * @param {Array<{type: string, content: string}>} lines
   * @returns {HTMLElement}
   */
  function createRenderedDiffView(lines) {
    var chunks = buildChunks(lines);

    var wrapper = document.createElement('div');
    wrapper.className = 'bookmarklet-rendered-diff';
    wrapper.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    wrapper.style.fontSize = '14px';
    wrapper.style.lineHeight = '1.5';
    wrapper.style.border = '1px solid #e1e4e8';
    wrapper.style.borderRadius = '3px';
    wrapper.style.background = '#fff';
    wrapper.style.padding = '10px 0';
    wrapper.style.overflowX = 'auto';

    chunks.forEach(function (chunk) {
      wrapper.appendChild(renderChunk(chunk));
    });

    return wrapper;
  }

  /* ------------------------------------------------------------------ */
  /* Toggle button                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Creates the toggle button used to switch between code diff and rendered diff.
   *
   * @returns {HTMLButtonElement}
   */
  function createToggleButton() {
    var btn = document.createElement('button');
    btn.className = 'bookmarklet-toggle-btn';
    btn.textContent = 'Show Rendered Diff';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('title', 'Toggle rendered markdown diff view');

    btn.style.marginLeft = '8px';
    btn.style.padding = '3px 10px';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '500';
    btn.style.lineHeight = '20px';
    btn.style.cursor = 'pointer';
    btn.style.color = '#fff';
    btn.style.backgroundColor = '#2ea44f';
    btn.style.border = '1px solid rgba(27,31,35,.15)';
    btn.style.borderRadius = '6px';
    btn.style.whiteSpace = 'nowrap';
    btn.style.verticalAlign = 'middle';

    return btn;
  }

  /* ------------------------------------------------------------------ */
  /* Page augmentation                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Finds all markdown file diffs on the page and augments each with a
   * rendered-markdown toggle button.
   */
  function augmentPage() {
    var fileContainers = document.querySelectorAll('.file');
    var augmented = 0;

    Array.prototype.forEach.call(fileContainers, function (container) {
      // Skip already-augmented containers
      if (container.dataset.mdDiffAugmented) return;

      // Determine whether this diff is for a .md file.
      // GitHub sets `title` on the link/element containing the filename.
      var titleEl = container.querySelector('[title$=".md"]');
      if (!titleEl) {
        // Fallback: look at text content of the file-info link
        var linkEl = container.querySelector('.file-info a, .file-header a');
        if (!linkEl) return;
        var name = (linkEl.getAttribute('title') || linkEl.textContent || '').trim();
        if (!name.toLowerCase().endsWith('.md')) return;
      }

      var table = container.querySelector('table');
      if (!table) return;

      var lines = parseDiffTable(table);
      if (!lines.length) return;

      container.dataset.mdDiffAugmented = 'true';

      // Build the rendered view (hidden initially)
      var renderedDiff = createRenderedDiffView(lines);
      renderedDiff.style.display = 'none';

      // Insert rendered view after the table (or its wrapper)
      var insertAfter = table.parentNode;
      insertAfter.parentNode.insertBefore(renderedDiff, insertAfter.nextSibling);

      // Wire up the toggle button
      var btn = createToggleButton();
      var showing = false;

      btn.addEventListener('click', function () {
        showing = !showing;
        btn.setAttribute('aria-pressed', String(showing));

        if (showing) {
          table.style.display = 'none';
          renderedDiff.style.display = 'block';
          btn.textContent = 'Show Code Diff';
        } else {
          table.style.display = '';
          renderedDiff.style.display = 'none';
          btn.textContent = 'Show Rendered Diff';
        }
      });

      // Attach button to file-actions bar or the file header
      var actionBar =
        container.querySelector('.file-actions') ||
        container.querySelector('.file-header');
      if (actionBar) {
        actionBar.appendChild(btn);
      }

      augmented++;
    });

    if (augmented === 0) {
      console.warn('[MD Diff] No markdown file diffs found on this page.');
    } else {
      console.log('[MD Diff] Augmented ' + augmented + ' markdown diff(s).');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Entry point                                                          */
  /* ------------------------------------------------------------------ */

  init();
})();
