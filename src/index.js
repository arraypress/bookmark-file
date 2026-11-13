/**
 * @arraypress/bookmark-file
 *
 * Reading and writing the Netscape bookmark file
 * (`<!DOCTYPE NETSCAPE-Bookmark-file-1>`), the format Chrome's own
 * "Export bookmarks" writes and every browser imports.
 *
 * Real bookmark files are messy HTML: `<p>` and `<DT>` are never closed,
 * tags come in upper case, Firefox puts a folder's `<DD>` before its `<DL>`.
 * {@link parseBookmarkHtml} is a small tolerant reader of its own, with no
 * DOM, so it reads the same everywhere: a page, a service worker (which has
 * no `DOMParser`) and Node. It reads only what a person opening the file
 * would see (nothing inside a script, style, template or comment), in time
 * in step with the file's size whatever the file holds.
 *
 * Pure: no `chrome.*`, no DOM, no clock. Zero dependencies.
 *
 * @module @arraypress/bookmark-file
 */

/**
 * @typedef {Object} BookmarkFolder
 * @property {'folder'} type
 * @property {Record<string, string>} attrs - Attribute names upper-cased.
 * @property {string} title
 * @property {BookmarkNode[]} children
 *
 * @typedef {Object} BookmarkLink
 * @property {'link'} type
 * @property {Record<string, string>} attrs
 * @property {string} title
 * @property {string|null} description - The `<DD>` after it, newlines kept.
 *
 * @typedef {BookmarkFolder|BookmarkLink} BookmarkNode
 *
 * @typedef {Object} BookmarkTree
 * @property {string} title - The `<H1>` (else `<TITLE>`).
 * @property {boolean} isBookmarkFile - Whether it has the Netscape doctype or a `<DL>` of `<DT>`s.
 * @property {BookmarkFolder} root - What the outermost `<DL>` holds.
 */

/**
 * The largest file the reader takes unless told otherwise (characters): what's past it isn't
 * read. 2 MB is thousands of entries; a browser's export with every site's icon in it can be far
 * larger, so a reader of those passes its own `maxLength`.
 */
export const MAX_FILE_LENGTH = 2_000_000;

const DOCTYPE = /<!DOCTYPE\s+NETSCAPE-Bookmark-file-1\s*>/i;

/** Titles: one line, spaces collapsed. @param {string} text @returns {string} */
const cleanTitle = (text) => text.replace(/\s+/g, ' ').trim();
/** Descriptions: line breaks kept (as typed, `&#10;` or `<BR>`), the ends trimmed. @param {string} text @returns {string} */
const cleanDescription = (text) => text.replace(/\r\n?/g, '\n').trim();

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const NAMED = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', euro: '€', pound: '£'};

/**
 * Decode character references: numeric ones all, named ones the common few
 * (a writer escapes only `& < > "`; anything rarer is left as written).
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
    return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));?/g, (whole, dec, hex, name) => {
        if (dec || hex) {
            const code = dec ? Number(dec) : parseInt(hex, 16);
            if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
            return String.fromCodePoint(code);
        }
        return Object.hasOwn(NAMED, name.toLowerCase()) && name === name.toLowerCase() ? NAMED[name] : whole;
    });
}

/** One attribute of a tag (run only over a tag's own text, which {@link MAX_TAG_LENGTH} bounds). */
const ATTRIBUTE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;

/** A tag longer than this isn't one: a "<" with no ">" for pages is text. Keeps the scan linear whatever the file. */
const MAX_TAG_LENGTH = 8192;

/**
 * Elements whose contents a browser doesn't read as markup (or doesn't show):
 * everything up to their end tag is skipped. A file's entries are only what
 * a person opening the file would see, never something tucked in a script.
 */
const RAW_TEXT = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'XMP', 'NOEMBED', 'NOFRAMES', 'PLAINTEXT', 'SVG', 'MATH', 'OBJECT']);

/** Folders nest this deep at most; lists inside deeper ones put their entries in the deepest kept. */
const MAX_DEPTH = 32;

/**
 * @typedef {{text: string, name?: undefined} | {name: string, closing: boolean, attrs: string, text?: undefined}} Token -
 *   Text between tags, or a tag (its name in capitals).
 */

/**
 * The tags and the text between them, in order: one pass over the file,
 * each character looked at a fixed number of times (a file of "<a " with no
 * ">" took a regular expression minutes). Comments, doctypes and the
 * contents of {@link RAW_TEXT} elements are left out; `<TITLE>`'s contents
 * are text, as in a browser.
 *
 * @param {string} source
 * @returns {Generator<Token>}
 */
function* tokens(source) {
    const length = source.length;
    let at = 0;
    /** Where the next ">" is (looked for again only once passed): -1 when there's none left. */
    let nextClose = -2;
    while (at < length) {
        const open = source.indexOf('<', at);
        if (open === -1) {
            yield {text: source.slice(at)};
            return;
        }
        if (open > at) yield {text: source.slice(at, open)};
        if (source.startsWith('<!--', open)) {
            const end = source.indexOf('-->', open + 4);
            at = end === -1 ? length : end + 3;
            continue;
        }
        if (source[open + 1] === '!' || source[open + 1] === '?') {
            const end = source.indexOf('>', open + 2);
            at = end === -1 ? length : end + 1;
            continue;
        }
        const closing = source[open + 1] === '/';
        const nameStart = open + (closing ? 2 : 1);
        let nameEnd = nameStart;
        while (nameEnd < length && /[a-zA-Z0-9]/.test(source[nameEnd])) nameEnd++;
        if (nameEnd === nameStart || !/[a-zA-Z]/.test(source[nameStart])) {
            // A stray "<": text.
            yield {text: '<'};
            at = open + 1;
            continue;
        }
        if (nextClose !== -1 && nextClose < nameEnd) nextClose = source.indexOf('>', nameEnd);
        if (nextClose === -1 || nextClose - nameEnd > MAX_TAG_LENGTH) {
            // No ">" near enough to end it: text.
            yield {text: '<'};
            at = open + 1;
            continue;
        }
        // The tag's end: the first ">" outside a quoted attribute value.
        let end = -1;
        let quote = '';
        const limit = Math.min(length, nameEnd + MAX_TAG_LENGTH);
        for (let i = nameEnd; i < limit; i++) {
            const char = source[i];
            if (quote) {
                if (char === quote) quote = '';
            } else if (char === '"' || char === "'") {
                // A quote opens a value only straight after "=".
                if (/=\s*$/.test(source.slice(Math.max(nameEnd, i - 8), i))) quote = char;
            } else if (char === '>') {
                end = i;
                break;
            }
        }
        if (end === -1) {
            yield {text: '<'};
            at = open + 1;
            continue;
        }
        const name = source.slice(nameStart, nameEnd).toUpperCase();
        at = end + 1;
        if (!closing && (RAW_TEXT.has(name) || name === 'TITLE')) {
            // To its end tag (any case), or the end of the file.
            const close = new RegExp(`</${name}\\s*>`, 'i');
            close.lastIndex = 0;
            const rest = source.slice(at);
            const found = close.exec(rest);
            const inner = found ? rest.slice(0, found.index) : rest;
            at = found ? at + found.index + found[0].length : length;
            if (name === 'TITLE') {
                yield {name, closing: false, attrs: ''};
                yield {text: inner};
                yield {name, closing: true, attrs: ''};
            }
            continue;
        }
        yield {name, closing, attrs: source.slice(nameEnd, end)};
    }
}

/** @param {string} source */
function parseAttributes(source) {
    /** @type {Record<string, string>} */
    const attrs = {};
    for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) {
        const key = name.toUpperCase();
        if (!(key in attrs)) attrs[key] = decodeEntities(double ?? single ?? bare ?? '');
    }
    return attrs;
}

/**
 * Read a bookmark file without a DOM.
 *
 * @param {string} html - The file's text.
 * @param {{maxLength?: number}} [options] - `maxLength`: how much of the file is read, in
 *   characters (default {@link MAX_FILE_LENGTH}).
 * @returns {BookmarkTree} Its folders and links, in order.
 * @example
 * parseBookmarkHtml('<DL><DT><A HREF="https://example.com/">Example</A></DL>').root.children[0]
 * // { type: 'link', attrs: { HREF: 'https://example.com/' }, title: 'Example', description: null }
 */
export function parseBookmarkHtml(html, { maxLength = MAX_FILE_LENGTH } = {}) {
    const source = String(html ?? '').slice(0, maxLength);
    /** @type {BookmarkFolder} */
    const root = {type: 'folder', attrs: {}, title: '', children: []};
    /** Folders whose `<DL>` is open; the bottom one is the root. */
    const stack = [root];
    let rootOpened = false;
    let sawEntry = false;
    /** A folder whose heading ended and whose `<DL>` hasn't opened yet. */
    let pendingFolder = /** @type {BookmarkFolder|null} */ (null);
    let lastLink = /** @type {BookmarkLink|null} */ (null);
    /** What text is being collected for: an A's or H3's title, a DD, the H1 or TITLE. */
    let capture = /** @type {{kind: 'title'|'dd'|'h1'|'doc-title', target?: any, text: string}|null} */ (null);
    let h1 = '';
    let docTitle = '';

    const finish = () => {
        if (!capture) return;
        const {kind, target, text} = capture;
        if (kind === 'title') target.title = cleanTitle(decodeEntities(text));
        else if (kind === 'dd') target.description = cleanDescription(text);
        else if (kind === 'h1' && !h1) h1 = cleanTitle(decodeEntities(text));
        else if (kind === 'doc-title' && !docTitle) docTitle = cleanTitle(decodeEntities(text));
        capture = null;
    };
    const top = () => stack[stack.length - 1];

    for (const token of tokens(source)) {
        if (token.name === undefined) {
            if (capture) capture.text += capture.kind === 'dd' ? decodeEntities(token.text) : token.text;
            continue;
        }
        const {name, closing, attrs: rawAttrs} = token;

        if (capture?.kind === 'dd') {
            // A description runs until the next entry or the end of its list; BR is a line break.
            if (name === 'BR') {
                capture.text += '\n';
                continue;
            }
            if (!['DT', 'DD', 'DL', 'H3', 'A'].includes(name)) continue;
            finish();
        }

        if (closing) {
            if (name === 'A' || name === 'H3' || name === 'H1' || name === 'TITLE') finish();
            if (name === 'DL') {
                pendingFolder = null;
                lastLink = null;
                if (stack.length > 1) stack.pop();
            }
            continue;
        }

        switch (name) {
            case 'TITLE':
                finish();
                capture = {kind: 'doc-title', text: ''};
                break;
            case 'H1':
                finish();
                capture = {kind: 'h1', text: ''};
                break;
            case 'H3': {
                finish();
                sawEntry = true;
                /** @type {BookmarkFolder} */
                const folder = {type: 'folder', attrs: parseAttributes(rawAttrs), title: '', children: []};
                top().children.push(folder);
                pendingFolder = folder;
                lastLink = null;
                capture = {kind: 'title', target: folder, text: ''};
                break;
            }
            case 'A': {
                finish();
                sawEntry = true;
                /** @type {BookmarkLink} */
                const link = {type: 'link', attrs: parseAttributes(rawAttrs), title: '', description: null};
                top().children.push(link);
                pendingFolder = null;
                lastLink = link;
                capture = {kind: 'title', target: link, text: ''};
                break;
            }
            case 'DD':
                finish();
                if (lastLink && lastLink.description === null) capture = {kind: 'dd', target: lastLink, text: ''};
                lastLink = null;
                break;
            case 'DT':
                finish();
                lastLink = null;
                break;
            case 'DL':
                finish();
                if (!rootOpened) {
                    rootOpened = true; // The outermost list is the root itself.
                } else if (pendingFolder && stack.length < MAX_DEPTH) {
                    stack.push(pendingFolder);
                } else {
                    stack.push(top()); // A list with no heading: its entries belong here.
                }
                pendingFolder = null;
                lastLink = null;
                break;
            default:
                // P, META, BR outside a description, and anything else: ignored.
                break;
        }
    }
    finish();
    return {title: h1 || docTitle, isBookmarkFile: DOCTYPE.test(source) || (rootOpened && sawEntry), root};
}

/**
 * Read a bookmark file: {@link parseBookmarkHtml} by the name its callers know it by. One reader
 * everywhere, so what one place shows of a file is what another does with it.
 *
 * @param {string} html - The file's text.
 * @param {{maxLength?: number}} [options] - As {@link parseBookmarkHtml}'s.
 * @returns {BookmarkTree} Its folders and links, in order.
 */
export function readBookmarkFile(html, options) {
    return parseBookmarkHtml(html, options);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Escape text for an attribute value in double quotes.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeAttribute(text) {
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape a title or description: line breaks as `&#10;`, so each entry stays on one line.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n?/g, '\n').replace(/\n/g, '&#10;');
}

/**
 * @typedef {Object} WriteFolder
 * @property {'folder'} type
 * @property {WriteAttrs} attrs - In the order to write them.
 * @property {string} title
 * @property {WriteNode[]} children
 *
 * @typedef {{type: 'link', attrs: WriteAttrs, title: string, description?: string}} WriteLink
 * @typedef {[string, string|undefined][]} WriteAttrs - Name and value; an empty or missing value isn't written.
 * @typedef {WriteFolder|WriteLink} WriteNode
 */

/**
 * A bookmark file, laid out as Chrome writes one (four-space indents, `<p>`
 * after every `<DL>`), so it opens in any browser's bookmark import.
 *
 * @param {{title: string, comment?: string, children: WriteNode[]}} file - `title`: the file's
 *   heading; `comment`: a line for whoever opens the file as text (left out when empty).
 * @returns {string} The file's text.
 * @example
 * writeBookmarkFile({ title: 'Bookmarks', children: [{ type: 'link', attrs: [['HREF', 'https://example.com/']], title: 'Example' }] })
 */
export function writeBookmarkFile({title, comment = '', children}) {
    const lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        ...(comment ? [`<!-- ${String(comment).replace(/--/g, '—')} -->`] : []),
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        `<TITLE>${escapeText(title)}</TITLE>`,
        `<H1>${escapeText(title)}</H1>`,
        '<DL><p>',
    ];
    const attrs = (/** @type {WriteAttrs} */ list) => list.map(([name, value]) => (value ? ` ${name}="${escapeAttribute(value)}"` : '')).join('');
    /**
     * @param {WriteNode[]} nodes
     * @param {number} depth
     */
    const write = (nodes, depth) => {
        const pad = '    '.repeat(depth);
        for (const node of nodes) {
            if (node.type === 'folder') {
                lines.push(`${pad}<DT><H3${attrs(node.attrs)}>${escapeText(node.title)}</H3>`, `${pad}<DL><p>`);
                write(node.children, depth + 1);
                lines.push(`${pad}</DL><p>`);
            } else {
                lines.push(`${pad}<DT><A${attrs(node.attrs)}>${escapeText(node.title)}</A>`);
                if (node.description) lines.push(`${pad}<DD>${escapeText(node.description)}`);
            }
        }
    };
    write(children, 1);
    lines.push('</DL><p>');
    return `${lines.join('\n')}\n`;
}
