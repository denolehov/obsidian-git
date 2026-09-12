import type { EditorView } from "@codemirror/view";
import {
    parseConflictBlocks,
    resolveBlockText,
    type ConflictBlock,
    type ConflictChoice,
} from "./model";

export function resolveConflict(
    view: EditorView,
    block: ConflictBlock,
    choice: ConflictChoice
): void {
    view.dispatch({
        changes: {
            from: block.from,
            to: block.to,
            insert: resolveBlockText(block, choice),
        },
    });
    view.focus();
}

export function resolveAllConflicts(
    view: EditorView,
    choice: ConflictChoice
): void {
    const blocks = parseConflictBlocks(view.state.doc.toString());
    view.dispatch({
        changes: blocks.map((block) => ({
            from: block.from,
            to: block.to,
            insert: resolveBlockText(block, choice),
        })),
    });
    view.focus();
}
