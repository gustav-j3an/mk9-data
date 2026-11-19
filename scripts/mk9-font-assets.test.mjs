import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const fontFiles = [
  'public/fonts/plus-jakarta-sans-variable.ttf',
  'public/fonts/jetbrains-mono-variable.ttf',
  'public/fonts/material-symbols-outlined-variable.woff2',
];

test('brand typography and Material Symbols use licensed local font assets', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('src/index.css', 'utf8');
  const sw = await readFile('public/sw.js', 'utf8');

  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.match(html, /\/fonts\/plus-jakarta-sans-variable\.ttf/);
  assert.match(css, /font-family:\s*'Plus Jakarta Sans'[\s\S]*?url\('\/fonts\/plus-jakarta-sans-variable\.ttf'\)/);
  assert.match(css, /font-family:\s*'JetBrains Mono'[\s\S]*?url\('\/fonts\/jetbrains-mono-variable\.ttf'\)/);
  assert.match(css, /font-family:\s*'Material Symbols Outlined'[\s\S]*?url\('\/fonts\/material-symbols-outlined-variable\.woff2'\)/);
  assert.match(css, /\.font-sans\s*\{[^}]*font-family:\s*'Plus Jakarta Sans'/s);
  assert.match(css, /\.material-symbols-outlined\s*\{[^}]*font-feature-settings:\s*'liga'/s);
  assert.match(sw, /mk9-date-shell-v5/);

  for (const [index, path] of fontFiles.entries()) {
    const data = await readFile(path);
    assert.ok(data.length > 100_000, `${path} is unexpectedly small`);
    if (index === 2) assert.equal(data.toString('ascii', 0, 4), 'wOF2', 'Material Symbols must be WOFF2');
    else assert.equal(data.toString('hex', 0, 4), '00010000', `${path} must be a TrueType font`);
  }

  for (const path of [
    'public/fonts/plus-jakarta-sans-OFL.txt',
    'public/fonts/jetbrains-mono-OFL.txt',
    'public/fonts/material-symbols-OFL.txt',
  ]) {
    assert.match(await readFile(path, 'utf8'), /Open Font License/i, `${path} must retain its font license`);
  }

  try {
    await stat('dist/index.html');
    const builtHtml = await readFile('dist/index.html', 'utf8');
    assert.doesNotMatch(builtHtml, /fonts\.(?:googleapis|gstatic)\.com/);
    const cssFiles = await readdir('dist/assets');
    const entryCss = cssFiles.find(path => /^index-.*\.css$/.test(path));
    assert.ok(entryCss, 'Vite output is missing its entry stylesheet');
    const builtCss = await readFile(`dist/assets/${entryCss}`, 'utf8');
    assert.doesNotMatch(builtCss, /fonts\.(?:googleapis|gstatic)\.com/);
    assert.match(builtCss, /\/fonts\/material-symbols-outlined-variable\.woff2/);
    for (const path of fontFiles) {
      const built = await readFile(path.replace(/^public\//, 'dist/'));
      assert.ok(built.length > 100_000, `${path} is missing from the Vite output`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
});
