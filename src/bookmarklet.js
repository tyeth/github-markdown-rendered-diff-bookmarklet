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
        fg:             '#e6edf3',
        codeBg:         'rgba(110,118,129,0.4)',
        codeBorder:     'rgba(110,118,129,0.3)'
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
      fg:             '#1f2328',
      codeBg:         'rgba(175,184,193,0.2)',
      codeBorder:     'rgba(31,35,40,0.15)'
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
   * Converts any pipe-table rows found in rendered HTML to proper <table> elements.
   * Works as a post-processor on the final HTML so it handles table rows that
   * were split across hunks or chunks. Looks for lines matching `| ... | ... |`
   * patterns in text nodes / <p> / <br>-separated content.
   *
   * @param {string} html
   * @returns {string}
   */
  function postProcessTables(html) {
    // Split on block boundaries so pipe-table rows land on their own lines
    var lines = html
      .replace(/<\/p>\s*<p>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/(<\/h[1-6]>|<\/div>|<\/blockquote>|<\/pre>|<\/ul>|<\/ol>|<\/table>)/g, '$1\n')
      .replace(/(<h[1-6][^>]*>|<div[^>]*>|<blockquote[^>]*>|<pre[^>]*>|<ul[^>]*>|<ol[^>]*>)/g, '\n$1')
      .split('\n');
    var out = [];
    var tableRows = [];

    function flushTable() {
      if (tableRows.length < 2) {
        // Not enough rows for a table — emit as-is
        tableRows.forEach(function (r) { out.push(r); });
        tableRows = [];
        return;
      }
      // Split into separate tables at each separator row (|---|---|)
      // The row immediately before a separator is the header of that table,
      // so pop it from the previous table and start a new one.
      var tables = [[]];
      tableRows.forEach(function (row) {
        var stripped = row.replace(/<[^>]*>/g, '').trim();
        if (/^[\s|:-]+$/.test(stripped) && stripped.indexOf('-') !== -1) {
          // Separator row — the last row in the current table is actually
          // the header for this new table
          var cur = tables[tables.length - 1];
          var header = cur.length > 0 ? cur.pop() : null;
          if (cur.length > 0 || tables.length > 1) {
            tables.push([]);
          }
          if (header) tables[tables.length - 1].push(header);
          return;
        }
        tables[tables.length - 1].push(row);
      });

      tables.forEach(function (rows) {
        if (rows.length === 0) return;
        var tbl = '<table style="border-collapse:collapse;margin:4px 0">';
        rows.forEach(function (row, rowIdx) {
          var tag = rowIdx === 0 ? 'th' : 'td';
          // Protect | inside <code> tags before splitting
          var safe = row.replace(/<code[^>]*>[\s\S]*?<\/code>/g, function (m) {
            return m.replace(/\|/g, '\x00P\x00');
          });
          // Split the HTML on | that are outside tags
          var parts = [];
          var current = '', inTag = false;
          for (var ci = 0; ci < safe.length; ci++) {
            var ch = safe.charAt(ci);
            if (ch === '<') inTag = true;
            else if (ch === '>') inTag = false;
            if (ch === '|' && !inTag) {
              parts.push(current);
              current = '';
            } else {
              current += ch;
            }
          }
          parts.push(current);
          // First and last parts are outside the table pipes — skip them
          var cells = parts.slice(1, -1);
          if (cells.length === 0) return;
          tbl += '<tr>';
          cells.forEach(function (cell) {
            cell = cell.replace(/\x00P\x00/g, '|').trim();
            tbl += '<' + tag + ' style="border:1px solid currentColor;padding:2px 8px;opacity:0.8">'
                 + cell + '</' + tag + '>';
          });
          tbl += '</tr>';
        });
        tbl += '</table>';
        out.push(tbl);
      });
      tableRows = [];
    }

    var inPre = false;
    lines.forEach(function (line) {
      if (/<pre[\s>]/i.test(line)) inPre = true;
      if (inPre) {
        if (tableRows.length > 0) flushTable();
        // Preserve newlines inside pre blocks — they were split by our \n split
        if (out.length > 0 && !/<pre[\s>]/i.test(line)) {
          out[out.length - 1] += '\n' + line;
        } else {
          out.push(line);
        }
        if (/<\/pre>/i.test(line)) inPre = false;
        return;
      }
      var stripped = line.replace(/<[^>]*>/g, '').trim();
      if (/^\|.+\|$/.test(stripped)) {
        tableRows.push(line);
      } else {
        if (tableRows.length > 0) flushTable();
        out.push(line);
      }
    });
    if (tableRows.length > 0) flushTable();

    return out.join('');
  }

  /**
   * Parses markdown to HTML using snarkdown, then post-processes to convert
   * any pipe tables that snarkdown doesn't handle.
   *
   * @param {string} text
   * @returns {string}
   */
  /**
   * Fixes orphaned code fences before markdown parsing. When diff chunks
   * split a fenced code block across type boundaries, one chunk gets the
   * opening ``` and another gets the closing ```. Snarkdown can't match
   * these, so we manually wrap the orphaned content in <pre><code>.
   */
  function fixOrphanedFences(text) {
    var lines = text.split('\n');
    var result = [];
    var inFence = false;
    var fenceContent = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var isFence = /^`{3,}/.test(line.trim());

      if (isFence && !inFence) {
        // Opening fence — check if there's a matching close
        var hasClose = false;
        for (var j = i + 1; j < lines.length; j++) {
          if (/^`{3,}\s*$/.test(lines[j].trim())) { hasClose = true; break; }
        }
        if (hasClose) {
          // Balanced — pass through for snarkdown to handle
          result.push(line);
          inFence = true;
        } else {
          // Orphaned opening fence — collect everything after as <pre>
          var lang = line.trim().replace(/^`{3,}\s*/, '');
          var codeLines = [];
          for (i++; i < lines.length; i++) { codeLines.push(lines[i]); }
          var escaped = codeLines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          result.push('<pre class="code ' + lang + '"><code>' + escaped + '</code></pre>');
        }
      } else if (isFence && inFence) {
        // Closing fence
        result.push(line);
        inFence = false;
      } else if (!inFence && i === 0 && !isFence) {
        // Check: does this chunk start mid-code-block? That happens when
        // a code fence was opened in a previous chunk and this chunk has
        // the closing fence. We detect this by: the first fence is a bare
        // ``` (no language), AND no line before it looks like markdown
        // (headings, lists, etc.) — just plain text/code.
        var firstFenceIdx = -1;
        for (var k = 0; k < lines.length; k++) {
          if (/^`{3,}/.test(lines[k].trim())) { firstFenceIdx = k; break; }
        }
        var looksLikeCode = firstFenceIdx > 0 && /^`{3,}\s*$/.test(lines[firstFenceIdx].trim());
        // If any line before the fence looks like markdown, it's not orphaned code
        if (looksLikeCode) {
          for (var k2 = 0; k2 < firstFenceIdx; k2++) {
            if (/^#{1,6}\s|^\s*[-*+]\s|^\|/.test(lines[k2])) { looksLikeCode = false; break; }
          }
        }
        if (looksLikeCode) {
          var codePart = lines.slice(0, firstFenceIdx);
          var escaped = codePart.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          result.push('<pre class="code"><code>' + escaped + '</code></pre>');
          i = firstFenceIdx; // skip past the closing fence
        } else {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    }
    return result.join('\n');
  }

  function parseMarkdown(text) {
    var parse = window.snarkdown || snarkdown;
    return postProcessTables(parse(fixOrphanedFences(text)));
  }

  /**
   * Applies word-level highlighting to a chunk's rendered HTML.
   * Parses markdown first, then diffs the plain-text content of the
   * rendered HTML against the paired chunk to find changed words,
   * and wraps them with <mark> in the final output.
   *
   * @param {string} markdown  The raw markdown text for this chunk
   * @param {string|null} pairMarkdown  The paired chunk's text (del for add, add for del)
   * @param {string} wordBg  Background colour for the <mark> highlights
   * @returns {string}  HTML string
   */
  function renderMarkdownWithHighlights(markdown, pairMarkdown, wordBg) {
    var html = parseMarkdown(markdown);
    if (!pairMarkdown) return html;

    // Diff on the raw markdown text to find changed words
    var segments = diffWords(pairMarkdown, markdown);
    if (!segments) return html;

    // Build a set of changed words/phrases from the markdown
    var changedTexts = [];
    segments.forEach(function (seg) {
      if (seg.changed && seg.text.trim()) {
        // Split into individual words for matching in HTML
        seg.text.split(/(\s+)/).forEach(function (w) {
          if (w.trim()) changedTexts.push(w.trim());
        });
      }
    });
    if (changedTexts.length === 0) return html;

    // Escape for regex and build pattern matching any changed word
    var escaped = changedTexts.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    // Sort longest first to match greedily
    escaped.sort(function (a, b) { return b.length - a.length; });
    var pattern = new RegExp('(' + escaped.join('|') + ')', 'g');

    // Apply highlights only to text nodes (not inside tags)
    var markOpen = '<mark style="background:' + wordBg + ';border-radius:3px;padding:0 1px">';
    html = html.replace(/(<[^>]*>)|([^<]+)/g, function (m, tag, text) {
      if (tag) return tag;
      return text.replace(pattern, markOpen + '$1</mark>');
    });

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
      div.style.padding = '2px 8px 2px 24px';
    } else if (chunk.type === 'delete') {
      div.innerHTML = renderMarkdownWithHighlights(markdown, pairMarkdown, colors.delWordBg);
      div.style.backgroundColor = colors.delBg;
      div.style.borderLeft = '4px solid ' + colors.delBorder;
      div.style.padding = '2px 8px 2px 24px';
    } else {
      div.innerHTML = parseMarkdown(markdown);
      div.style.padding = '2px 8px 2px 28px';
    }

    // Ensure lists aren't clipped against the left edge
    var lists = div.querySelectorAll('ul, ol');
    for (var li = 0; li < lists.length; li++) {
      lists[li].style.paddingInlineStart = '20px';
    }

    // Style inline code
    var codes = div.querySelectorAll('code');
    for (var ci = 0; ci < codes.length; ci++) {
      var c = codes[ci];
      // Skip if inside a <pre> (block code gets styled on the pre)
      if (c.parentNode && c.parentNode.nodeName === 'PRE') continue;
      c.style.background = colors.codeBg;
      c.style.border = '1px solid ' + colors.codeBorder;
      c.style.borderRadius = '6px';
      c.style.padding = '0.2em 0.4em';
      c.style.fontSize = '85%';
      c.style.fontFamily = 'ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace';
    }

    // Style code blocks
    var pres = div.querySelectorAll('pre');
    for (var pi = 0; pi < pres.length; pi++) {
      pres[pi].style.background = colors.codeBg;
      pres[pi].style.border = '1px solid ' + colors.codeBorder;
      pres[pi].style.borderRadius = '6px';
      pres[pi].style.padding = '12px';
      pres[pi].style.overflow = 'auto';
      pres[pi].style.fontSize = '85%';
      pres[pi].style.fontFamily = 'ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace';
    }

    return div;
  }

  /**
   * Applies shared wrapper styles.
   */
  function styleWrapper(el, colors) {
    el.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    el.style.fontSize = '14px';
    el.style.lineHeight = '1.5';
    el.style.border = '1px solid ' + colors.wrapperBorder;
    el.style.borderRadius = '3px';
    el.style.background = colors.wrapperBg;
    el.style.color = colors.fg;
    el.style.overflowX = 'auto';
  }

  /**
   * Populates a container with chunks, pairing adjacent delete→add for
   * word-level highlighting.
   */
  function appendChunks(container, chunks, colors) {
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      if (chunk.type === 'delete' && i + 1 < chunks.length && chunks[i + 1].type === 'add') {
        container.appendChild(renderChunk(chunk, chunks[i + 1], colors));
        i++;
        container.appendChild(renderChunk(chunks[i], chunks[i - 1], colors));
      } else {
        container.appendChild(renderChunk(chunk, null, colors));
      }
    }
  }

  /**
   * Builds the complete rendered-diff container from an array of diff lines.
   * When isSplit is true, renders two side-by-side panes (old on left, new
   * on right) to match GitHub's split diff layout.
   *
   * @param {Array<{type: string, content: string}>} lines
   * @param {boolean} isSplit
   * @returns {HTMLElement}
   */
  function createRenderedDiffView(lines, isSplit) {
    var chunks = buildChunks(lines);
    var colors = getThemeColors();

    var wrapper = document.createElement('div');
    wrapper.className = 'bookmarklet-rendered-diff';

    if (!isSplit) {
      // Unified view — single column
      styleWrapper(wrapper, colors);
      wrapper.style.padding = '10px 0';
      appendChunks(wrapper, chunks, colors);
      return wrapper;
    }

    // Split view: In split diffs, lines from the left (delete) and right (add)
    // sides are interleaved row-by-row. This produces many tiny 1-line chunks
    // that break markdown rendering (tables, code blocks span multiple lines).
    // Fix: collect left-side lines (delete+context) and right-side lines
    // (add+context) separately, build proper chunks for each side, then
    // render them in a two-column table layout.
    styleWrapper(wrapper, colors);
    wrapper.style.padding = '0';

    var leftLines = [];
    var rightLines = [];
    lines.forEach(function (line) {
      if (line.type === 'context') {
        leftLines.push(line);
        rightLines.push(line);
      } else if (line.type === 'delete') {
        leftLines.push(line);
      } else if (line.type === 'add') {
        rightLines.push(line);
      }
    });

    var leftChunks = buildChunks(leftLines);
    var rightChunks = buildChunks(rightLines);

    var tbl = document.createElement('table');
    tbl.className = 'bookmarklet-split-table';
    tbl.style.width = '100%';
    tbl.style.borderCollapse = 'collapse';
    tbl.style.tableLayout = 'fixed';

    function makePane(paneChunks) {
      var td = document.createElement('td');
      td.style.width = '50%';
      td.style.verticalAlign = 'top';
      td.style.padding = '10px 0';
      appendChunks(td, paneChunks, colors);
      return td;
    }

    var tr = document.createElement('tr');
    var leftTd = makePane(leftChunks);
    leftTd.className = 'bookmarklet-split-left';
    var rightTd = makePane(rightChunks);
    rightTd.className = 'bookmarklet-split-right';
    rightTd.style.borderLeft = '1px solid ' + colors.wrapperBorder;

    tr.appendChild(leftTd);
    tr.appendChild(rightTd);
    tbl.appendChild(tr);
    wrapper.appendChild(tbl);
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
      // Detect split view: classic UI uses file-diff-split class,
      // React UI uses 4-column layout with left/right-side-diff-cell classes
      var isSplit = table.classList.contains('file-diff-split') ||
                    !!table.querySelector('.left-side-diff-cell, .right-side-diff-cell');
      var renderedDiff = createRenderedDiffView(lines, isSplit);
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
