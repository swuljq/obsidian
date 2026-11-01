# Code Title Fence 1.1.7

Use a fence such as:

    ```python:main.py
    print("Hello")
    ```

Features:

- `python:main.py` -> Python syntax highlighting + `main.py` title
- Automatic line numbers in Reading View
- Keeps line numbers out of copied code
- Keeps the original highlighted code DOM intact
- v1.1.2 fixes long code blocks whose line numbers could stop early
- v1.1.2 aligns the language badge with the code column instead of the gutter

- v1.1.3 fixes cumulative vertical drift between line numbers and code rows.
- v1.1.3 uses the effective PRE/CODE line-box height for the gutter.
- v1.1.3 avoids height-based line over-counting unless text counting is unavailable.

- v1.1.4 forces code rows to stay unwrapped so logical lines and gutter rows remain 1:1.
- v1.1.4 also uses rendered row count as a safety fallback after no-wrap is enforced.


## v1.1.5

- Line-number gutter is now a separate fixed grid column.
- Horizontal scrolling is isolated to the code column, preventing text from sliding under the gutter.
- Tightened line-number row metrics to reduce theme/snippet alignment drift.


## v1.1.6

- Keeps Obsidian's native copy button fixed at the visible top-right corner while code scrolls horizontally.
- Keeps the language badge visually anchored during horizontal scrolling.
- Preserves the native copy button click handler by moving the existing DOM node instead of cloning it.

## v1.1.7

- Skips `mermaid`, `table`, `dataview`, `dataviewjs`, `query`, and `tasks` blocks so their dedicated renderers can process the original DOM.
- Prevents Code Title Fence from making Mermaid and other rendered blocks blank in Reading View.
