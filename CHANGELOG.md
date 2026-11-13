# Changelog

All notable changes to `@arraypress/bookmark-file` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — Unreleased

The reader and writer Better Typing has used for its command packs (`tabby/src/packs/bookmark-file.js`), as a library, so Better Bookmarks reads and writes whole browser exports with the same code.

### Added

- `parseBookmarkHtml(html, { maxLength })` (and `readBookmarkFile`, the same): a tolerant reader with no DOM. `maxLength` is new: Better Typing's packs are text and keep the 2,000,000-character default (`MAX_FILE_LENGTH`); a browser's export with icons is larger.
- `writeBookmarkFile({ title, comment, children })`: `comment` is now optional.
- `decodeEntities(text)`.
