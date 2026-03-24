// @ts-check
/**
 * Playwright tests for the GitHub Markdown Rendered Diff Bookmarklet.
 *
 * Tests run against REAL GitHub page HTML saved as fixtures:
 *   - pr-changes-react.html: React-based diff (logged-in PR /changes page)
 *   - tree-compare-classic.html: Classic diff (tree compare / branch compare page)
 *
 * A minimal snarkdown shim is injected so tests run without the real
 * markdown parser and without internet access.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOOKMARKLET_PATH   = path.resolve(__dirname, '../src/bookmarklet.js');
const PR_REACT_FIXTURE   = path.resolve(__dirname, 'fixtures/pr-changes-react.html');
const TREE_CLASSIC_FIXTURE = path.resolve(__dirname, 'fixtures/tree-compare-classic.html');

const bookmarkletSource = fs.readFileSync(BOOKMARKLET_PATH, 'utf-8');

/**
 * A minimal snarkdown-compatible browser shim for tests.
 * Handles enough Markdown to verify rendered diff output.
 */
const SNARKDOWN_SHIM = `
(function (global) {
  function snarkdown(text) {
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
      .replace(/\\\`(.+?)\\\`/g, '<code>$1</code>')
      // links
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
      // paragraphs / blank lines
      .replace(/\\n\\n+/g, '</p><p>')
      .replace(/\\n/g, '<br>');
    return '<p>' + html + '</p>';
  }
  global.snarkdown = snarkdown;
}(window));
`;

/**
 * Load a local HTML fixture and inject the snarkdown shim.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fixturePath  Absolute path to the fixture HTML file.
 */
async function loadFixture(page, fixturePath) {
  const html = fs.readFileSync(fixturePath, 'utf-8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  // Pre-inject the snarkdown shim so the bookmarklet finds window.snarkdown
  await page.evaluate(SNARKDOWN_SHIM);
}

/**
 * Inject the bookmarklet into the page and wait for augmentation to complete.
 *
 * @param {import('@playwright/test').Page} page
 */
async function runBookmarklet(page) {
  await page.evaluate(bookmarkletSource);
  await page.waitForSelector('.bookmarklet-toggle-btn', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests: PR changes page (React-based / logged-in UI)
// README.md with 552 additions, 136 deletions
// ---------------------------------------------------------------------------

test.describe('PR changes page (React UI)', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page, PR_REACT_FIXTURE);
  });

  test('adds exactly one toggle button for the .md file diff', async ({ page }) => {
    await runBookmarklet(page);
    await expect(page.locator('.bookmarklet-toggle-btn')).toHaveCount(1);
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

    const btn      = page.locator('.bookmarklet-toggle-btn');
    const table    = page.locator('table[data-diff-anchor]');
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
    const table    = page.locator('table[data-diff-anchor]');
    const rendered = page.locator('.bookmarklet-rendered-diff');

    await btn.click();
    await btn.click();

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

    // Green-tinted background (light: #e6ffec, dark: rgba green)
    const bg = await addChunks.first().evaluate(el => el.style.backgroundColor);
    expect(bg).toMatch(/230, 255, 236|46,\s*160,\s*67/);
  });

  test('deleted chunks have a red background', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    const delChunks = page.locator('.bookmarklet-diff-chunk--delete');
    await expect(delChunks).not.toHaveCount(0);

    // Red-tinted background (light: #ffebe9, dark: rgba red)
    const bg = await delChunks.first().evaluate(el => el.style.backgroundColor);
    expect(bg).toMatch(/255, 235, 233|248,\s*81,\s*73/);
  });

  test('rendered diff contains diff content (headings, text)', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').click();

    const rendered = page.locator('.bookmarklet-rendered-diff');
    // Added heading
    await expect(rendered).toContainText('How Does It Work?');
    // Deleted heading
    await expect(rendered).toContainText('How Will It Work?');
    // Context line
    await expect(rendered).toContainText('Wippersnapper Component Definitions');
  });

  test('does not augment the page twice when the bookmarklet runs again', async ({ page }) => {
    await runBookmarklet(page);
    await page.evaluate(bookmarkletSource);

    await expect(page.locator('.bookmarklet-toggle-btn')).toHaveCount(1);
    await expect(page.locator('.bookmarklet-rendered-diff')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Tree compare page (classic / logged-out UI)
// README.md among ~50 other files, classic .file / .blob-code structure
// ---------------------------------------------------------------------------

test.describe('Tree compare page (classic UI)', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page, TREE_CLASSIC_FIXTURE);
  });

  test('adds toggle button(s) only to .md file diffs, not .json/.js/.vue', async ({ page }) => {
    await runBookmarklet(page);

    // Should have button(s) for .md file(s) only
    const buttons = page.locator('.bookmarklet-toggle-btn');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // No .json or .js file should have a toggle button
    const jsonFiles = page.locator('.file[data-file-type=".json"] .bookmarklet-toggle-btn');
    await expect(jsonFiles).toHaveCount(0);
    const jsFiles = page.locator('.file[data-file-type=".js"] .bookmarklet-toggle-btn');
    await expect(jsFiles).toHaveCount(0);
  });

  test('toggle button initial label is "Show Rendered Diff"', async ({ page }) => {
    await runBookmarklet(page);
    await expect(page.locator('.bookmarklet-toggle-btn').first()).toHaveText('Show Rendered Diff');
  });

  test('rendered diff is hidden before the button is clicked', async ({ page }) => {
    await runBookmarklet(page);
    await expect(page.locator('.bookmarklet-rendered-diff').first()).toBeHidden();
  });

  test('clicking toggle shows rendered diff and hides code table', async ({ page }) => {
    await runBookmarklet(page);

    const btn = page.locator('.bookmarklet-toggle-btn').first();
    await btn.click();

    await expect(page.locator('.bookmarklet-rendered-diff').first()).toBeVisible();
    await expect(btn).toHaveText('Show Code Diff');
  });

  test('clicking toggle a second time restores the code table', async ({ page }) => {
    await runBookmarklet(page);

    const btn = page.locator('.bookmarklet-toggle-btn').first();
    await btn.click();
    await btn.click();

    await expect(page.locator('.bookmarklet-rendered-diff').first()).toBeHidden();
    await expect(btn).toHaveText('Show Rendered Diff');
  });

  test('added chunks have a green background', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').first().click();

    const addChunks = page.locator('.bookmarklet-diff-chunk--add');
    await expect(addChunks).not.toHaveCount(0);

    // Green-tinted background (light: #e6ffec, dark: rgba green)
    const bg = await addChunks.first().evaluate(el => el.style.backgroundColor);
    expect(bg).toMatch(/230, 255, 236|46,\s*160,\s*67/);
  });

  test('deleted chunks have a red background', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').first().click();

    const delChunks = page.locator('.bookmarklet-diff-chunk--delete');
    await expect(delChunks).not.toHaveCount(0);

    // Red-tinted background (light: #ffebe9, dark: rgba red)
    const bg = await delChunks.first().evaluate(el => el.style.backgroundColor);
    expect(bg).toMatch(/255, 235, 233|248,\s*81,\s*73/);
  });

  test('rendered diff contains content from the README', async ({ page }) => {
    await runBookmarklet(page);
    await page.locator('.bookmarklet-toggle-btn').first().click();

    const rendered = page.locator('.bookmarklet-rendered-diff').first();
    // The README.md in this compare has "ProtoMQ" heading
    await expect(rendered).toContainText('ProtoMQ');
  });

  test('does not augment the page twice when the bookmarklet runs again', async ({ page }) => {
    await runBookmarklet(page);
    const countBefore = await page.locator('.bookmarklet-toggle-btn').count();

    await page.evaluate(bookmarkletSource);
    const countAfter = await page.locator('.bookmarklet-toggle-btn').count();

    expect(countAfter).toBe(countBefore);
  });
});
