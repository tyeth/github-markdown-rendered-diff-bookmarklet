// @ts-check
/**
 * Playwright tests for the GitHub Markdown Rendered Diff Bookmarklet.
 *
 * Tests run against local HTML fixtures that mirror the DOM structure of
 * https://github.com/adafruit/Wippersnapper_Components/pull/301/changes
 * (README.md, 552 additions, 136 deletions).
 *
 * marked.js CDN requests are intercepted and fulfilled with a minimal
 * browser-compatible implementation so tests run without internet access.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOOKMARKLET_PATH = path.resolve(__dirname, '../src/bookmarklet.js');
const INLINE_FIXTURE   = path.resolve(__dirname, 'fixtures/inline-diff.html');
const SPLIT_FIXTURE    = path.resolve(__dirname, 'fixtures/split-diff.html');

const bookmarkletSource = fs.readFileSync(BOOKMARKLET_PATH, 'utf-8');

/**
 * A minimal marked.js browser shim used to intercept the CDN request.
 * Handles enough Markdown to verify green/red rendering of PR #301 content.
 */
const MARKED_SHIM = `
(function (global) {
  function parse(text) {
    if (!text) return '';
    var html = text
      // headings
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // bold / italic
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
      // inline code
      .replace(/\`(.+?)\`/g, '<code>$1</code>')
      // links
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
      // paragraphs / blank lines
      .replace(/\\n\\n+/g, '</p><p>')
      .replace(/\\n/g, '<br>');
    return '<p>' + html + '</p>';
  }
  global.marked = { parse: parse };
}(window));
`;

/**
 * Load a local HTML fixture and intercept the marked CDN request.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fixturePath  Absolute path to the fixture HTML file.
 */
async function loadFixture(page, fixturePath) {
  // Intercept any request that looks like the marked CDN URL
  await page.route('**marked**', route =>
    route.fulfill({ contentType: 'application/javascript', body: MARKED_SHIM })
  );

  const html = fs.readFileSync(fixturePath, 'utf-8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

/**
 * Inject the bookmarklet into the page and wait for augmentation to complete.
 * The bookmarklet loads marked.js (intercepted above) asynchronously via a
 * <script> tag, so we wait until `.bookmarklet-toggle-btn` is present.
 *
 * @param {import('@playwright/test').Page} page
 */
async function runBookmarklet(page) {
  await page.evaluate(bookmarkletSource);
  // If marked was loaded synchronously (window.marked already set), the
  // buttons appear immediately.  If not, we wait up to 5 s for the CDN
  // script tag to load and fire onload.
  await page.waitForSelector('.bookmarklet-toggle-btn', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests: inline (unified) diff view  —  based on PR #301
// ---------------------------------------------------------------------------

test.describe('Inline diff view (unified)', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page, INLINE_FIXTURE);
  });

  test('adds a toggle button ONLY to the .md file diff', async ({ page }) => {
    await runBookmarklet(page);

    const buttons = page.locator('.bookmarklet-toggle-btn');
    await expect(buttons).toHaveCount(1);

    // The button lives inside the README.md file container
    const mdContainer = page.locator('#diff-readme');
    await expect(mdContainer.locator('.bookmarklet-toggle-btn')).toBeVisible();

    // The JSON file container must NOT have a toggle button
    const jsonContainer = page.locator('#diff-json');
    await expect(jsonContainer.locator('.bookmarklet-toggle-btn')).toHaveCount(0);
  });

  test('toggle button initial label is "Show Rendered Diff"', async ({ page }) => {
    await runBookmarklet(page);
    await expect(page.locator('.bookmarklet-toggle-btn')).toHaveText('Show Rendered Diff');
  });

  test('rendered diff is hidden before the button is clicked', async ({ page }) => {
    await runBookmarklet(page);
    await expect(page.locator('.bookmarklet-rendered-diff')).toBeHidden();
  });

  test('clicking toggle shows rendered diff and hides code table', async ({ page }) => {
    await runBookmarklet(page);

    const btn   = page.locator('.bookmarklet-toggle-btn');
    const table = page.locator('#diff-readme table');
    const rendered = page.locator('.bookmarklet-rendered-diff');

    await btn.click();

    await expect(rendered).toBeVisible();
    await expect(table).toBeHidden();
    await expect(btn).toHaveText('Show Code Diff');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking toggle a second time restores the code table', async ({ page }) => {
    await runBookmarklet(page);

    const btn      = page.locator('.bookmarklet-toggle-btn');
    const table    = page.locator('#diff-readme table');
    const rendered = page.locator('.bookmarklet-rendered-diff');

    await btn.click(); // → rendered
    await btn.click(); // → code diff

    await expect(table).toBeVisible();
    await expect(rendered).toBeHidden();
    await expect(btn).toHaveText('Show Rendered Diff');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('added chunks have a green background', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    const addChunks = page.locator('.bookmarklet-diff-chunk--add');
    await expect(addChunks).not.toHaveCount(0);

    const firstAdd = addChunks.first();
    const bgColor = await firstAdd.evaluate(el => el.style.backgroundColor);
    expect(bgColor).toBe('rgb(230, 255, 237)'); // #e6ffed
  });

  test('deleted chunks have a red background', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    const delChunks = page.locator('.bookmarklet-diff-chunk--delete');
    await expect(delChunks).not.toHaveCount(0);

    const firstDel = delChunks.first();
    const bgColor = await firstDel.evaluate(el => el.style.backgroundColor);
    expect(bgColor).toBe('rgb(255, 238, 240)'); // #ffeef0
  });

  test('rendered diff contains content from the PR (headings, links)', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    const rendered = page.locator('.bookmarklet-rendered-diff');

    // New heading from PR #301 should appear somewhere in the rendered diff
    await expect(rendered).toContainText('How Does It Work?');

    // The old (deleted) heading should also appear somewhere in the rendered diff
    await expect(rendered).toContainText('How Will It Work?');
  });

  test('markdown links in additions are rendered as <a> elements', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    // The addition contains [WipperSnapper](url) — must become an <a>
    const addChunk = page.locator('.bookmarklet-diff-chunk--add').first();
    const link = addChunk.locator('a[href*="wippersnapper"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('WipperSnapper');
  });

  test('does not augment the page twice when the bookmarklet runs again', async ({ page }) => {
    await runBookmarklet(page);
    // Run the bookmarklet a second time
    await page.evaluate(bookmarkletSource);

    // Must still have exactly one toggle button and one rendered view
    await expect(page.locator('.bookmarklet-toggle-btn')).toHaveCount(1);
    await expect(page.locator('.bookmarklet-rendered-diff')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: split (side-by-side) diff view  —  based on PR #301
// ---------------------------------------------------------------------------

test.describe('Split diff view (side-by-side)', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page, SPLIT_FIXTURE);
  });

  test('adds a toggle button to the .md file diff in split view', async ({ page }) => {
    await runBookmarklet(page);
    await expect(page.locator('.bookmarklet-toggle-btn')).toHaveCount(1);
  });

  test('clicking toggle shows rendered diff in split view', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    await expect(page.locator('.bookmarklet-rendered-diff')).toBeVisible();
    await expect(page.locator('#diff-readme-split table')).toBeHidden();
  });

  test('context lines are not duplicated in split view', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    // "# Wippersnapper Component Definitions" is a context line that appears
    // in both the left and right columns of the split view table.
    // The rendered diff must show it only once.
    const HEADING_PATTERN = /Wippersnapper Component Definitions/g;
    const rendered = page.locator('.bookmarklet-rendered-diff');
    const allText  = await rendered.textContent();
    const count    = (allText.match(HEADING_PATTERN) || []).length;
    expect(count).toBe(1);
  });

  test('split view: paired deletion + addition render in correct chunks', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    // Both deleted and added intro paragraphs must appear in separate chunks
    const del = page.locator('.bookmarklet-diff-chunk--delete');
    const add = page.locator('.bookmarklet-diff-chunk--add');

    await expect(del).not.toHaveCount(0);
    await expect(add).not.toHaveCount(0);
  });
});
