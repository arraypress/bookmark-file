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
export type BookmarkFolder = {
    type: 'folder';
    /**
     * - Attribute names upper-cased.
     */
    attrs: Record<string, string>;
    title: string;
    children: BookmarkNode[];
};
export type BookmarkLink = {
    type: 'link';
    attrs: Record<string, string>;
    title: string;
    /**
     * - The `<DD>` after it, newlines kept.
     */
    description: string | null;
};
export type BookmarkNode = BookmarkFolder | BookmarkLink;
export type BookmarkTree = {
    /**
     * - The `<H1>` (else `<TITLE>`).
     */
    title: string;
    /**
     * - Whether it has the Netscape doctype or a `<DL>` of `<DT>`s.
     */
    isBookmarkFile: boolean;
    /**
     * - What the outermost `<DL>` holds.
     */
    root: BookmarkFolder;
};
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
export declare const MAX_FILE_LENGTH = 2000000;
/**
 * Decode character references: numeric ones all, named ones the common few
 * (a writer escapes only `& < > "`; anything rarer is left as written).
 *
 * @param {string} text
 * @returns {string}
 */
export declare function decodeEntities(text: string): string;
export type Token = {
    text: string;
    name?: undefined;
} | {
    name: string;
    closing: boolean;
    attrs: string;
    text?: undefined;
};
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
export declare function parseBookmarkHtml(html: string, { maxLength }?: {
    maxLength?: number;
}): BookmarkTree;
/**
 * Read a bookmark file: {@link parseBookmarkHtml} by the name its callers know it by. One reader
 * everywhere, so what one place shows of a file is what another does with it.
 *
 * @param {string} html - The file's text.
 * @param {{maxLength?: number}} [options] - As {@link parseBookmarkHtml}'s.
 * @returns {BookmarkTree} Its folders and links, in order.
 */
export declare function readBookmarkFile(html: string, options?: {
    maxLength?: number;
}): BookmarkTree;
export type WriteFolder = {
    type: 'folder';
    /**
     * - In the order to write them.
     */
    attrs: WriteAttrs;
    title: string;
    children: WriteNode[];
};
export type WriteLink = {
    type: 'link';
    attrs: WriteAttrs;
    title: string;
    description?: string;
};
export type WriteAttrs = [string, string | undefined][];
export type WriteNode = WriteFolder | WriteLink;
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
export declare function writeBookmarkFile({ title, comment, children }: {
    title: string;
    comment?: string;
    children: WriteNode[];
}): string;
