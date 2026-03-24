/**
 * GitHub Markdown Rendered Diff Bookmarklet
 *
 * Augments GitHub pull request diff pages with a rendered markdown viewer
 * for any .md files. Shows changed content with green/red banding and
 * supports both inline (unified) and split (side-by-side) diff views.
 * A toggle button on each markdown diff file lets you switch between the
 * original code diff and the rendered diff.
 *
 * Supports both the classic (logged-out) GitHub UI and the newer
 * React-based (logged-in) diff viewer.
 *
 * Usage: paste the contents of this file (wrapped in `javascript:(function(){...})();`)
 * into a browser bookmark's URL field.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                            */
  /* ------------------------------------------------------------------ */

  function init() {
    // snarkdown is inlined by the build script; also works when loaded
    // in test environments via evaluate().
    if (typeof snarkdown === 'undefined' && typeof window.snarkdown === 'undefined') {
      console.error('[MD Diff] snarkdown is not available. Run the build to inline it.');
      return;
    }
    augmentPage();
  }

  /* ------------------------------------------------------------------ */
  /* UI mode detection                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Detects whether a container uses the new React-based diff UI.
   * In the new UI, containers have `data-diff-anchor` and tables use
   * `aria-label` instead of `.file-header` / `[title$=".md"]`.
   *
   * @param {Element} container
   * @returns {boolean}
   */
  function isReactUI(container) {
    return !container.classList.contains('file');
  }

  /* ------------------------------------------------------------------ */
  /* Diff table parsing                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Returns the semantic type of a single diff cell.
   * Handles both old UI (`.blob-code-addition` etc. on the `<td>`)
   * and new UI (`addition`/`deletion` on the inner `<code>` element).
   *
   * @param {Element} cell
   * @returns {'add'|'delete'|'context'|null}
   */
  function getCellType(cell) {
    // Old UI: classes on the <td> itself
    if (cell.classList.contains('blob-code-addition')) return 'add';
    if (cell.classList.contains('blob-code-deletion')) return 'delete';
    if (cell.classList.contains('blob-code-context')) return 'context';

    // New React UI: type is on the <code> child element
    var code = cell.querySelector('code');
    if (code) {
      if (code.classList.contains('addition')) return 'add';
      if (code.classList.contains('deletion')) return 'delete';
      // A code element without addition/deletion is a context line
      if (code.classList.contains('diff-text')) return 'context';
    }

    return null;
  }

  /**
   * Extracts the raw markdown text from a diff cell.
   *
   * Old UI: `.blob-code-inner` with optional `data-code-marker`.
   * New UI: `.diff-text-inner` div inside the `<code>` element.
   *
   * @param {Element} cell
   * @returns {string}
   */
  function getCellContent(cell) {
    // Old UI
    var inner = cell.querySelector('.blob-code-inner');
    if (inner) {
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

    // New React UI
    var diffInner = cell.querySelector('.diff-text-inner');
    if (diffInner) {
      return diffInner.textContent;
    }

    return '';
  }

  /**
   * Parses a diff `<table>` and returns an ordered array of line objects.
   *
   * Handles both inline (unified) and split (side-by-side) diff views,
   * and both old and new GitHub UI structures.
   *
   * @param {HTMLTableElement} table
   * @returns {Array<{type: 'add'|'delete'|'context', content: string}>}
   */
  function parseDiffTable(table) {
    var lines = [];

    var rows = table.querySelectorAll('tbody tr');
    rows.forEach(function (row) {
      // Try old UI selector first, fall back to new UI selector
      var codeCells = Array.prototype.slice.call(row.querySelectorAll('.blob-code'));
      if (codeCells.length === 0) {
        codeCells = Array.prototype.slice.call(row.querySelectorAll('.diff-text-cell'));
      }

      // Skip hunk-header rows (@@ ... @@)
      if (codeCells.length === 0) return;
      if (row.classList.contains('js-expandable-line')) return;

      var contextSeenInRow = false;

      codeCells.forEach(function (cell) {
        var type = getCellType(cell);
        if (!type) return;

        // In split view, both halves of an unchanged line are context --
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
    var parse = window.snarkdown || snarkdown;
    var html = parse(markdown);

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
   * Checks whether a container represents a .md file diff.
   *
   * Old UI: looks for `[title$=".md"]` or text content of file-info links.
   * New UI: checks the table's `aria-label` attribute for `.md` extension.
   *
   * @param {Element} container
   * @param {boolean} reactUI
   * @returns {boolean}
   */
  function isMarkdownFile(container, reactUI) {
    if (reactUI) {
      // New React UI: check the table's aria-label
      var table = container.querySelector('table[aria-label]');
      if (table) {
        var label = table.getAttribute('aria-label') || '';
        return /\.md$/i.test(label);
      }
      return false;
    }

    // Old UI
    var titleEl = container.querySelector('[title$=".md"]');
    if (titleEl) return true;

    var linkEl = container.querySelector('.file-info a, .file-header a');
    if (!linkEl) return false;
    var name = (linkEl.getAttribute('title') || linkEl.textContent || '').trim();
    return name.toLowerCase().endsWith('.md');
  }

  /**
   * Attaches the toggle button to the appropriate location.
   *
   * Old UI: `.file-actions` or `.file-header`.
   * New UI: `[class*="DiffFileHeader"]` or insert before the table's parent.
   *
   * @param {Element} container
   * @param {HTMLButtonElement} btn
   * @param {boolean} reactUI
   */
  function attachButton(container, btn, reactUI) {
    if (reactUI) {
      var header = container.querySelector('[class*="DiffFileHeader"]');
      if (header) {
        header.appendChild(btn);
        return;
      }
      // Fallback: insert at the top of the container
      container.insertBefore(btn, container.firstChild);
      return;
    }

    // Old UI
    var actionBar =
      container.querySelector('.file-actions') ||
      container.querySelector('.file-header');
    if (actionBar) {
      actionBar.appendChild(btn);
    }
  }

  /**
   * Finds all markdown file diffs on the page and augments each with a
   * rendered-markdown toggle button. Supports both old and new GitHub UI.
   */
  function augmentPage() {
    // Try old UI first, then fall back to new React UI
    var fileContainers = document.querySelectorAll('.file');
    var reactUI = false;

    if (fileContainers.length === 0) {
      // New React UI (PR changes / compare pages): the wrapper div has a
      // class containing "Diff-module__diff__" and contains the diff table.
      // Fall back to any element whose table child has data-diff-anchor
      // (in case class names change).
      fileContainers = document.querySelectorAll('[class*="Diff-module__diff__"]');
      if (fileContainers.length === 0) {
        // Broader fallback: find tables with data-diff-anchor and use their parent containers
        var tables = document.querySelectorAll('table[data-diff-anchor]');
        if (tables.length > 0) {
          var containers = [];
          tables.forEach(function (t) { containers.push(t.parentElement.parentElement || t.parentElement); });
          fileContainers = containers;
        }
      }
      reactUI = true;
    }

    if (fileContainers.length === 0) {
      console.warn('[MD Diff] No .file containers found. GitHub may be using a different UI.');
      console.warn('[MD Diff] Debug: body classes = ' + document.body.className);
      return;
    }

    var augmented = 0;

    Array.prototype.forEach.call(fileContainers, function (container) {
      // Skip already-augmented containers
      if (container.dataset.mdDiffAugmented) return;

      // Determine whether this diff is for a .md file
      if (!isMarkdownFile(container, reactUI)) return;

      var table = container.querySelector('table');
      if (!table) {
        console.warn('[MD Diff] .md file found but no diff table yet — content may still be loading. Try running the bookmarklet again.');
        return;
      }

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

      // Attach button to the appropriate location
      attachButton(container, btn, reactUI);

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
