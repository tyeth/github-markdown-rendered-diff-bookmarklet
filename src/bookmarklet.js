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
  /* Theme detection                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Detects whether the page is in dark mode by inspecting GitHub's
   * `data-color-mode` / `data-dark-theme` attributes on <html>, or
   * falling back to the `prefers-color-scheme` media query.
   *
   * @returns {boolean}
   */
  function isDarkMode() {
    var root = document.documentElement;
    var mode = root.getAttribute('data-color-mode');
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    // "auto" — follow system preference
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Returns a palette of colours appropriate for the current theme.
   */
  function getThemeColors() {
    if (isDarkMode()) {
      return {
        wrapperBg:      '#0d1117',
        wrapperBorder:  '#30363d',
        addBg:          'rgba(46,160,67,0.15)',
        addBorder:      '#238636',
        addWordBg:      'rgba(46,160,67,0.40)',
        delBg:          'rgba(248,81,73,0.15)',
        delBorder:      '#da3633',
        delWordBg:      'rgba(248,81,73,0.40)',
        fg:             '#e6edf3'
      };
    }
    return {
      wrapperBg:      '#ffffff',
      wrapperBorder:  '#d0d7de',
      addBg:          '#e6ffec',
      addBorder:      '#22863a',
      addWordBg:      '#abf2bc',
      delBg:          '#ffebe9',
      delBorder:      '#cb2431',
      delWordBg:      '#ff8182',
      fg:             '#1f2328'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Word-level diff highlighting                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Given two strings, returns an array of segments:
   *   { text, changed: boolean }
   * Uses a simple word-boundary split + LCS approach.
   */
  function diffWords(oldStr, newStr) {
    var oldWords = oldStr.split(/(\s+)/);
    var newWords = newStr.split(/(\s+)/);

    // Build LCS table
    var m = oldWords.length, n = newWords.length;
    // For very long diffs, skip word-level highlighting (perf guard)
    if (m * n > 50000) return null;

    var dp = [];
    var i, j;
    for (i = 0; i <= m; i++) {
      dp[i] = [];
      for (j = 0; j <= n; j++) {
        if (i === 0 || j === 0) { dp[i][j] = 0; }
        else if (oldWords[i - 1] === newWords[j - 1]) { dp[i][j] = dp[i - 1][j - 1] + 1; }
        else { dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); }
      }
    }

    // Backtrack to find which words are common
    var newChanged = [];
    for (j = 0; j < n; j++) newChanged[j] = true;
    i = m; j = n;
    while (i > 0 && j > 0) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        newChanged[j - 1] = false;
        i--; j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) { i--; }
      else { j--; }
    }

    // Merge consecutive same-state segments
    var result = [];
    for (j = 0; j < n; j++) {
      var last = result.length > 0 ? result[result.length - 1] : null;
      if (last && last.changed === newChanged[j]) {
        last.text += newWords[j];
      } else {
        result.push({ text: newWords[j], changed: newChanged[j] });
      }
    }
    return result;
  }

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
   * Applies word-level highlighting to a chunk's HTML.
   * When a delete chunk is immediately followed by an add chunk, we diff
   * the raw text word-by-word and wrap changed segments with <mark>.
   *
   * @param {string} markdown  The raw markdown text for this chunk
   * @param {string|null} pairMarkdown  The paired chunk's text (del for add, add for del)
   * @param {string} wordBg  Background colour for the <mark> highlights
   * @returns {string}  HTML string
   */
  function renderMarkdownWithHighlights(markdown, pairMarkdown, wordBg) {
    var parse = window.snarkdown || snarkdown;
    if (!pairMarkdown) return parse(markdown);

    var segments = diffWords(pairMarkdown, markdown);
    if (!segments) return parse(markdown);

    // Build highlighted plain text, then parse
    var highlighted = segments.map(function (seg) {
      if (seg.changed && seg.text.trim()) {
        return '⟪HLSTART⟫' + seg.text + '⟪HLEND⟫';
      }
      return seg.text;
    }).join('');

    var html = parse(highlighted);
    // Replace markers with <mark> tags (markers survive markdown parsing)
    html = html.replace(/⟪HLSTART⟫/g, '<mark style="background:' + wordBg + ';border-radius:3px;padding:0 1px">')
               .replace(/⟪HLEND⟫/g, '</mark>');
    return html;
  }

  /**
   * Renders a single chunk (group of same-type lines) as an HTML element.
   *
   * @param {{type: string, lines: string[]}} chunk
   * @param {{type: string, lines: string[]}|null} pairChunk  Adjacent paired chunk for word-diff
   * @param {object} colors  Theme colour palette
   * @returns {HTMLElement}
   */
  function renderChunk(chunk, pairChunk, colors) {
    var markdown = chunk.lines.join('\n');
    var pairMarkdown = pairChunk ? pairChunk.lines.join('\n') : null;

    var div = document.createElement('div');
    div.className = 'bookmarklet-diff-chunk bookmarklet-diff-chunk--' + chunk.type;

    if (chunk.type === 'add') {
      div.innerHTML = renderMarkdownWithHighlights(markdown, pairMarkdown, colors.addWordBg);
      div.style.backgroundColor = colors.addBg;
      div.style.borderLeft = '4px solid ' + colors.addBorder;
      div.style.paddingLeft = '8px';
      div.style.margin = '2px 0';
    } else if (chunk.type === 'delete') {
      div.innerHTML = renderMarkdownWithHighlights(markdown, pairMarkdown, colors.delWordBg);
      div.style.backgroundColor = colors.delBg;
      div.style.borderLeft = '4px solid ' + colors.delBorder;
      div.style.paddingLeft = '8px';
      div.style.margin = '2px 0';
    } else {
      div.innerHTML = (window.snarkdown || snarkdown)(markdown);
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
    var colors = getThemeColors();

    var wrapper = document.createElement('div');
    wrapper.className = 'bookmarklet-rendered-diff';
    wrapper.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    wrapper.style.fontSize = '14px';
    wrapper.style.lineHeight = '1.5';
    wrapper.style.border = '1px solid ' + colors.wrapperBorder;
    wrapper.style.borderRadius = '3px';
    wrapper.style.background = colors.wrapperBg;
    wrapper.style.color = colors.fg;
    wrapper.style.padding = '10px 0';
    wrapper.style.overflowX = 'auto';

    // Pair adjacent delete→add chunks for word-level highlighting
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      var pairChunk = null;

      if (chunk.type === 'delete' && i + 1 < chunks.length && chunks[i + 1].type === 'add') {
        pairChunk = chunks[i + 1]; // pair: del sees add
        wrapper.appendChild(renderChunk(chunk, pairChunk, colors));
        // Now render the add chunk paired with the del
        i++;
        wrapper.appendChild(renderChunk(chunks[i], chunk, colors));
      } else {
        wrapper.appendChild(renderChunk(chunk, null, colors));
      }
    }

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
