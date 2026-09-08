# Styling

Colors used by this plugin are exposed as CSS custom properties on
`.theme-dark, .theme-light`. Override them in a [CSS snippet](https://help.obsidian.md/How+to/Add+custom+styles#Use+Themes+and+or+CSS+snippets).

```css
.theme-dark,
.theme-light {
    --git-modified: var(--color-orange);
    --git-deleted: var(--color-red);

    --git-diff-delete-text-bg: rgba(255, 0, 0, 0.15);
    --git-diff-insert-text-bg: rgba(0, 200, 0, 0.15);
}
```

Reload (`Ctrl/Cmd+R`) after toggling a snippet so already-mounted editors
pick up the new values.

## Source control / history view

Color of the single-letter status markers shown next to changed files.


| Variable         | Default               | Marker               |
| ---------------- | --------------------- | -------------------- |
| `--git-modified` | `var(--color-orange)` | `M` — modified files |
| `--git-deleted`  | `var(--color-red)`    | `D` — deleted files  |


## Diff view

Colors used in the diff view.

| Variable          | Default     |
| ----------------- | ----------- |
| `--git-delete-bg` | `#ff475040` |
| `--git-delete-hl` | `#96050a75` |
| `--git-insert-bg` | `#68d36840` |
| `--git-insert-hl` | `#23c02350` |
| `--git-change-bg` | `#ffd55840` |
| `--git-selected`  | `#3572b0`   |
| `--git-delete`    | `#cc3333`   |
| `--git-insert`    | `#399839`   |
| `--git-change`    | `#d0b44c`   |
| `--git-move`      | `#3572b0`   |


Inline `changed-text` background within those lines:


| Variable                    | Default     |
| --------------------------- | ----------- |
| `--git-diff-delete-text-bg` | `#ee443330` |
| `--git-diff-insert-text-bg` | `#22bb2230` |


## Editor gutter markers

The thin bars in the editor's left gutter marking added, changed and
deleted lines. `size` is the bar thickness (width for add/change,
height for delete); `size-hover` kicks in when the line is hovered.

| Variable                         | Default          |
| -------------------------------- | ---------------- |
| `--git-gutter-marker-size`       | `0.2rem`         |
| `--git-gutter-marker-size-hover` | `0.6rem`         |
| `--git-gutter-marker-radius`     | `0`              |
