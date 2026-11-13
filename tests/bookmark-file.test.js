/**
 * Reading and writing Netscape bookmark files: the reader takes real exports and messy
 * hand-made files, hides nothing a person would see and shows nothing they wouldn't, stays
 * quick whatever the file holds, and a written file reads back the same.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { MAX_FILE_LENGTH, decodeEntities, parseBookmarkHtml, readBookmarkFile, writeBookmarkFile } from '../src/index.js';

/** @import { BookmarkFolder, BookmarkLink, BookmarkNode } from '../src/index.js' */

/**
 * A file in tests/fixtures.
 *
 * @param {string} name - Its name.
 * @returns {string} Its text.
 */
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

/**
 * Folder and link titles, nested, for comparing at a glance.
 *
 * @param {BookmarkFolder} folder - A folder.
 * @returns {unknown[]} Its outline.
 */
const outline = (folder) => folder.children.map((node) => (node.type === 'folder' ? { [node.title]: outline(node) } : node.title));

/**
 * The node, which must be a folder.
 *
 * @param {BookmarkNode | undefined} node - A node.
 * @returns {BookmarkFolder} It.
 */
function asFolder(node) {
  if (node?.type !== 'folder') throw new Error('not a folder');
  return node;
}

/**
 * The node, which must be a link.
 *
 * @param {BookmarkNode | undefined} node - A node.
 * @returns {BookmarkLink} It.
 */
function asLink(node) {
  if (node?.type !== 'link') throw new Error('not a link');
  return node;
}

/**
 * Every link's `SHORTCUTURL` (else its title), in order.
 *
 * @param {string} html - A file.
 * @returns {string[]} The names.
 */
function names(html) {
  /** @type {string[]} */
  const out = [];
  /** @param {BookmarkFolder} folder */
  const walk = (folder) => {
    for (const node of folder.children) {
      if (node.type === 'folder') walk(node);
      else out.push(node.attrs.SHORTCUTURL ?? node.title);
    }
  };
  walk(readBookmarkFile(html).root);
  return out;
}

const entry = (/** @type {string} */ name) => `<DT><A HREF="https://example.com/${name}" SHORTCUTURL="${name}">${name}</A>\n<DD>text\n`;
const file = (/** @type {string} */ inside) => `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${entry('seen')}${inside}</DL><p>\n`;

describe('a real Chrome export', () => {
  const tree = parseBookmarkHtml(fixture('chrome-bookmarks.html'));

  it('is a bookmark file; its folders, nesting and titles are read, entities decoded', () => {
    assert.equal(tree.isBookmarkFile, true);
    assert.equal(tree.title, 'Bookmarks');
    assert.deepEqual(outline(tree.root), [
      { 'Bookmarks bar': [
        'Inbox (1,204) - sam@example.com - Gmail',
        'Google Calendar - Week of 3 November 2026',
        'Notifications',
        { Work: [
          'Active issues › Web & App',
          'Q4 planning "draft" – Google Docs',
          { Dashboards: ['API latency', 'Status <prod>'] },
        ] },
        'Readability bookmarklet',
      ] },
      { 'Other bookmarks': [
        'London - BBC Weather',
        'Netscape Navigator – Wikipedia',
        { Recipes: ['Easy pancakes recipe | BBC Good Food', 'Panzanella Recipe – NYT Cooking'] },
        { 'Empty folder': [] },
      ] },
      { 'Mobile bookmarks': ['Big Ben – Google Maps'] },
    ]);
  });

  it('keeps attributes, upper-cased, with entities decoded', () => {
    const bar = asFolder(tree.root.children[0]);
    assert.equal(bar.attrs.PERSONAL_TOOLBAR_FOLDER, 'true');
    const api = asLink(asFolder(asFolder(bar.children[3]).children[2]).children[0]);
    assert.equal(api.attrs.HREF, 'https://grafana.example.com/d/abc123/api?orgId=1&from=now-24h&to=now');
    assert.match(api.attrs.ICON, /^data:image\/png;base64,/);
    assert.equal(api.description, null);
  });
});

describe('messy files', () => {
  it('reads a Firefox folder whose description comes before its list', () => {
    const tree = parseBookmarkHtml(fixture('firefox-bookmarks.html'));
    assert.equal(tree.title, 'Bookmarks Menu');
    assert.deepEqual(outline(tree.root), ['Getting Started', { 'Search keywords': ['Wikipedia', 'MDN search'] }, { 'Other Bookmarks': ['Add-ons'] }]);
    const wikipedia = asLink(asFolder(tree.root.children[1]).children[0]);
    assert.equal(wikipedia.attrs.SHORTCUTURL, 'w');
    assert.equal(wikipedia.description, 'Search Wikipedia');
  });

  it('reads lower-case tags, single-quoted and bare attributes, <BR>, raw newlines and unclosed tags', () => {
    const tree = parseBookmarkHtml(fixture('messy-hand-made.html'));
    const folder = asFolder(tree.root.children[0]);
    const links = folder.children.filter((node) => node.type === 'link');
    const byName = Object.fromEntries(links.reverse().map((node) => [node.attrs.SHORTCUTURL, node])); // The first of each wins.
    assert.equal(byName['/sig'].description, 'Best wishes,\nPat\nExample & Co');
    assert.equal(byName['/multi'].title, 'Multi-line, raw newlines');
    assert.equal(byName['/multi'].description, 'Line one\nLine two\n  indented line three');
    assert.equal(byName['/script'].description, '<script>alert(1)</script> and bold 😀 ©');
    assert.equal(byName['/empty'].description, '');
  });

  it('takes a page that isn’t a bookmark file for what it is', () => {
    assert.equal(parseBookmarkHtml('<!doctype html><title>Hi</title><p>Just a page</p>').isBookmarkFile, false);
    assert.deepEqual(parseBookmarkHtml('').root.children, []);
    assert.equal(parseBookmarkHtml('{"app": "Other"}').isBookmarkFile, false);
  });

  it('survives truncation half-way through a tag', () => {
    const html = fixture('chrome-bookmarks.html');
    const cut = html.slice(0, html.indexOf('Recipes') + 3);
    assert.equal(parseBookmarkHtml(cut).root.children.length, 2);
  });
});

describe('what a person opening the file would see, and no more', () => {
  it('reads nothing tucked in a script, style, textarea, template, comment or title', () => {
    for (const hide of [
      (/** @type {string} */ hidden) => `<script>${hidden}</script>`,
      (/** @type {string} */ hidden) => `<SCRIPT type="text/plain">${hidden}</SCRIPT >`,
      (/** @type {string} */ hidden) => `<style>${hidden}</style>`,
      (/** @type {string} */ hidden) => `<textarea>${hidden}</textarea>`,
      (/** @type {string} */ hidden) => `<template>${hidden}</template>`,
      (/** @type {string} */ hidden) => `<noscript>${hidden}</noscript>`,
      (/** @type {string} */ hidden) => `<!-- ${hidden} -->`,
      (/** @type {string} */ hidden) => `<![CDATA[ ${hidden.replaceAll('>', '')} ]]>`,
      // Never closed: the rest of the file is its contents.
      (/** @type {string} */ hidden) => `<script>${hidden}`,
    ]) assert.deepEqual(names(file(hide(entry('hidden')))), ['seen'], hide('…'));
    const inTitle = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<TITLE>x<DL><p>${entry('hidden')}</DL></TITLE>\n<H1>B</H1>\n<DL><p>\n${entry('seen')}</DL><p>\n`;
    assert.deepEqual(names(inTitle), ['seen']);
  });

  it('a quoted attribute may hold a ">"; a tag that never ends is text', () => {
    assert.deepEqual(names(file('<DT><A HREF="https://example.com/" SHORTCUTURL="gt" TITLE="a > b">gt</A>\n')), ['seen', 'gt']);
    assert.deepEqual(names(file('<DT><A HREF="https://example.com/" SHORTCUTURL="cut')), ['seen']);
  });
});

describe('size and time', () => {
  it('takes time in step with the file’s size, whatever it holds', () => {
    for (const piece of ['<a ', '<a b=', '<a x="', '<', '<!--', '<a href=\'']) {
      const started = performance.now();
      const tree = readBookmarkFile(piece.repeat(Math.floor(1_900_000 / piece.length)));
      assert.ok(performance.now() - started < 3000, piece);
      assert.ok(tree.root.children.length < 2, piece);
    }
  });

  it('folders nested thousands deep are read without running out of stack, the deepest ones flattened', () => {
    const deep = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n${'<DT><H3>a</H3>\n<DL><p>\n'.repeat(5000)}${entry('deep')}${'</DL><p>\n'.repeat(5001)}`;
    let depth = 0;
    for (let folder = readBookmarkFile(deep).root; folder.children.some((node) => node.type === 'folder'); depth++) {
      folder = asFolder(folder.children.find((node) => node.type === 'folder'));
    }
    assert.ok(depth < 40);
    assert.deepEqual(names(deep), ['deep']);
  });

  it('reads the first 2 MB unless given another limit', () => {
    const many = file(Array.from({ length: 30_000 }, (_, index) => entry(`n${index}`)).join(''));
    assert.ok(many.length > MAX_FILE_LENGTH);
    assert.ok(names(many).length < 30_001);
    assert.equal(readBookmarkFile(many, { maxLength: many.length }).root.children.length, 30_001);
    assert.equal(parseBookmarkHtml(file(entry('second')), { maxLength: 150 }).root.children.length, 1);
  });

  it('ten thousand links with icons are read in well under a second', () => {
    const icon = `data:image/png;base64,${'A'.repeat(900)}`;
    const big = file(Array.from({ length: 10_000 }, (_, index) => `<DT><A HREF="https://example.com/${index}" ADD_DATE="1700000000" ICON="${icon}">Page ${index}</A>\n`).join(''));
    const started = performance.now();
    const tree = parseBookmarkHtml(big, { maxLength: Infinity });
    assert.ok(performance.now() - started < 1000);
    assert.equal(tree.root.children.length, 10_001);
  });
});

describe('decodeEntities', () => {
  it('decodes numeric references and the common names; leaves the rest', () => {
    assert.equal(decodeEntities('a&#10;b&#x41;&amp;&lt;&gt;&quot;&#39;&nbsp;'), 'a\nbA&<>"\' ');
    assert.equal(decodeEntities('&unknown; &AMP; &#0; &#xD800;'), '&unknown; &AMP; � �');
  });
});

describe('writeBookmarkFile', () => {
  const children = /** @type {import('../src/index.js').WriteNode[]} */ ([
    { type: 'folder', attrs: [['ADD_DATE', '1'], ['EMPTY', '']], title: 'Folder <1>', children: [
      { type: 'link', attrs: [['HREF', 'https://example.com/x'], ['SHORTCUTURL', '/x']], title: 'X "quoted"', description: 'Two\nlines & <tags>' },
    ] },
    { type: 'link', attrs: [['HREF', 'https://example.com/?a=1&b=2']], title: 'Plain' },
  ]);

  it('writes what Chrome writes, and reads back the same', () => {
    const html = writeBookmarkFile({ title: 'Mine & yours', comment: 'a -- comment', children });
    assert.equal(html, [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- a — comment -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Mine &amp; yours</TITLE>',
      '<H1>Mine &amp; yours</H1>',
      '<DL><p>',
      '    <DT><H3 ADD_DATE="1">Folder &lt;1&gt;</H3>',
      '    <DL><p>',
      '        <DT><A HREF="https://example.com/x" SHORTCUTURL="/x">X "quoted"</A>',
      '        <DD>Two&#10;lines &amp; &lt;tags&gt;',
      '    </DL><p>',
      '    <DT><A HREF="https://example.com/?a=1&amp;b=2">Plain</A>',
      '</DL><p>',
      '',
    ].join('\n'));
    const back = parseBookmarkHtml(html);
    assert.equal(asLink(asFolder(back.root.children[0]).children[0]).description, 'Two\nlines & <tags>');
    assert.equal(back.root.children[1].attrs.HREF, 'https://example.com/?a=1&b=2');
  });

  it('leaves the comment line out when there is none', () => {
    assert.equal(writeBookmarkFile({ title: 'B', children: [] }), [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>B</TITLE>', '<H1>B</H1>', '<DL><p>', '</DL><p>', '',
    ].join('\n'));
  });

  it('a real export written again reads back with the same outline and addresses', () => {
    const tree = parseBookmarkHtml(fixture('chrome-bookmarks.html'));
    /** @param {BookmarkNode} node @returns {import('../src/index.js').WriteNode} */
    const toWrite = (node) => (node.type === 'folder'
      ? { type: 'folder', attrs: Object.entries(node.attrs), title: node.title, children: node.children.map(toWrite) }
      : { type: 'link', attrs: Object.entries(node.attrs), title: node.title });
    const again = parseBookmarkHtml(writeBookmarkFile({ title: tree.title, children: tree.root.children.map(toWrite) }));
    assert.deepEqual(again.root, tree.root);
  });
});
