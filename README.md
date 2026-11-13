# @arraypress/bookmark-file

Read and write the Netscape bookmark file (`<!DOCTYPE NETSCAPE-Bookmark-file-1>`): the HTML file Chrome's "Export bookmarks" writes and every browser imports.

The reader has no DOM, so it reads the same in a page, a service worker (which has no `DOMParser`) and Node. Real bookmark files are messy HTML (`<p>` and `<DT>` never closed, tags in either case, Firefox's `<DD>` before a folder's `<DL>`); it takes them as browsers do. It reads only what a person opening the file would see (nothing inside a script, style, template or comment) and takes time in step with the file's size, whatever the file holds.

Zero dependencies. Pure: no `chrome.*`, no DOM, no clock.

## Install

```bash
npm install @arraypress/bookmark-file
```

## Usage

```js
import { parseBookmarkHtml, writeBookmarkFile } from '@arraypress/bookmark-file';

const tree = parseBookmarkHtml(html);
tree.isBookmarkFile;        // the Netscape doctype, or a <DL> of <DT>s
tree.title;                 // the <H1> (else the <TITLE>)
tree.root.children;         // folders and links, in order

// { type: 'folder', attrs: { ADD_DATE: '1700000000', PERSONAL_TOOLBAR_FOLDER: 'true' }, title: 'Bookmarks bar', children: [...] }
// { type: 'link', attrs: { HREF: 'https://example.com/', ADD_DATE: '1700000000' }, title: 'Example', description: null }

const file = writeBookmarkFile({
  title: 'Bookmarks',
  comment: 'Exported by My App',   // optional
  children: [
    { type: 'folder', attrs: [['ADD_DATE', '1700000000']], title: 'Reading', children: [
      { type: 'link', attrs: [['HREF', 'https://example.com/'], ['ADD_DATE', '1700000000']], title: 'Example' },
    ] },
  ],
});
```

## API

### `parseBookmarkHtml(html, { maxLength }?)` → `BookmarkTree`

`{ title, isBookmarkFile, root }`. Attribute names are upper-cased, values and titles have their character references decoded, titles are one line with spaces collapsed, a link's `<DD>` is its `description` (line breaks kept, `<BR>` a line break; `null` when it has none). Folders nest at most 32 deep; lists inside deeper ones put their entries in the deepest kept. Only the first `maxLength` characters are read (default `MAX_FILE_LENGTH`, 2,000,000); a browser's export with every site's icon in it can be far larger, so pass your own limit for those.

`readBookmarkFile(html, options)` is the same function under another name.

### `writeBookmarkFile({ title, comment?, children })` → `string`

The file laid out as Chrome writes one (four-space indents, `<p>` after every `<DL>`), so it opens in any browser's bookmark import. `attrs` is a list of `[name, value]` in the order to write them; an empty or missing value isn't written. Titles, descriptions and attribute values are escaped; a line break in a title or description is written `&#10;`, so each entry stays on one line.

### `decodeEntities(text)` → `string`

Numeric character references, and the common named ones (`&amp; &lt; &gt; &quot; &apos; &nbsp;` and a few more); anything rarer is left as written.

## Development

`npm test` runs ESLint, a strict TypeScript check of the JSDoc (the `.d.ts` files are generated from it: `npm run types`), the tests (`node --test`) and the copied-code guard.

## License

MIT © 2026 David Sherlock / ArrayPress Limited
