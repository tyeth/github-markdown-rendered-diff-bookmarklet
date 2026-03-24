#!/usr/bin/env node
/**
 * Minifies src/bookmarklet.js into a single-line javascript: URI
 * suitable for use as a browser bookmarklet.
 *
 * Output: dist/bookmarklet.min.js  — the javascript:... one-liner
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const SRC = path.join(__dirname, '..', 'src', 'bookmarklet.js');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUT = path.join(DIST_DIR, 'bookmarklet.min.js');

async function build() {
  const source = fs.readFileSync(SRC, 'utf8');

  const result = await minify(source, {
    compress: {
      booleans_as_integers: false,
      passes: 2,
    },
    mangle: true,
    output: {
      ascii_only: true,
      comments: false,
    },
  });

  if (result.error) {
    throw result.error;
  }

  const oneliner = 'javascript:' + result.code;

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(OUT, oneliner, 'utf8');

  console.log('Built bookmarklet (%d bytes) -> %s', oneliner.length, OUT);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
