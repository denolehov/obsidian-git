import { StateField, type EditorState, type Range } from "@codemirror/state";
import {
    Decoration,
    EditorView,
    showPanel,
    WidgetType,
    type DecorationSet,
    type Panel,
    type PanelConstructor,
    type ViewUpdate,
} from "@codemirror/view";
import {
    ButtonComponent,
    editorInfoField,
    editorLivePreviewField,
} from "obsidian";
import { CONFLICT_OUTPUT_FILE } from "src/constants";
import { resolveAllConflicts, resolveConflict } from "./actions";
import {
    parseConflictBlocks,
    type ConflictBlock,
    type ConflictChoice,
} from "./model";

const CHOICES = ["ours", "theirs", "both"] as const;

function computeBlocks(state: EditorState): readonly ConflictBlock[] {
    if (!state.field(editorLivePreviewField, false)) {
        return [];
    }
    if (
        state.field(editorInfoField, false)?.file?.path === CONFLICT_OUTPUT_FILE
    ) {
        return [];
    }
    const text = state.doc.toString();
    return text.includes("<<<<<<<") ? parseConflictBlocks(text) : [];
}

export const conflictBlocksField = StateField.define<readonly ConflictBlock[]>({
    create: computeBlocks,
    update: (value, transaction) =>
        transaction.docChanged || transaction.reconfigured
            ? computeBlocks(transaction.state)
            : value,
});

function addButtons(
    parent: HTMLElement,
    labels: Record<ConflictChoice, string>,
    onPick: (choice: ConflictChoice) => void
): void {
    for (const choice of CHOICES) {
        new ButtonComponent(parent)
            .setButtonText(labels[choice])
            .onClick((event) => {
                event.preventDefault();
                onPick(choice);
            });
    }
}

class ConflictBlockWidget extends WidgetType {
    constructor(private readonly block: ConflictBlock) {
        super();
    }

    eq(other: ConflictBlockWidget): boolean {
        return (
            other.block.from === this.block.from &&
            other.block.to === this.block.to
        );
    }

    toDOM(view: EditorView): HTMLElement {
        const root = createDiv({ cls: "git-conflict" });

        const header = root.createDiv({ cls: "git-conflict-header" });
        header.createSpan({
            cls: "git-conflict-header-label",
            text: "Conflict",
        });
        addButtons(
            header,
            { ours: "Keep ours", theirs: "Keep theirs", both: "Keep both" },
            (choice) => resolveConflict(view, this.block, choice)
        );

        addSide(root, "ours", "Ours", this.block.ours);
        addSide(root, "theirs", "Theirs", this.block.theirs);

        return root;
    }
}

function addSide(
    parent: HTMLElement,
    cls: string,
    label: string,
    content: string
): void {
    const side = parent.createDiv({ cls: `git-conflict-side ${cls}` });
    side.createDiv({ cls: "git-conflict-side-label", text: label });
    side.createDiv({ cls: "git-conflict-side-content", text: content });
}

function buildDecorations(state: EditorState): DecorationSet {
    const blocks = state.field(conflictBlocksField, false) ?? [];
    const decorations: Range<Decoration>[] = [];
    for (const block of blocks) {
        decorations.push(
            Decoration.replace({
                widget: new ConflictBlockWidget(block),
                block: true,
            }).range(block.from, block.to)
        );
    }
    return Decoration.set(decorations, true);
}

export const conflictDecorationsField = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state),
    update: (value, transaction) =>
        transaction.docChanged || transaction.reconfigured
            ? buildDecorations(transaction.state)
            : value,
    provide: (field) => EditorView.decorations.from(field),
});

class ConflictPanel implements Panel {
    dom = createDiv({ cls: "git-conflict-panel" });
    top = true;

    constructor(private readonly view: EditorView) {
        this.render();
    }

    update(update: ViewUpdate): void {
        if (
            update.docChanged ||
            update.transactions.some((t) => t.reconfigured)
        ) {
            this.render();
        }
    }

    private render(): void {
        this.dom.empty();
        const blocks = this.view.state.field(conflictBlocksField, false) ?? [];
        if (blocks.length === 0) {
            return;
        }
        this.dom.createSpan({
            cls: "git-conflict-panel-label",
            text: `${blocks.length} conflict${
                blocks.length === 1 ? "" : "s"
            } in file`,
        });
        addButtons(
            this.dom,
            {
                ours: "Keep all ours",
                theirs: "Keep all theirs",
                both: "Keep both",
            },
            (choice) => resolveAllConflicts(this.view, choice)
        );
    }
}

const conflictPanelConstructor: PanelConstructor = (view) =>
    new ConflictPanel(view);

const conflictPanel = showPanel.compute([conflictBlocksField], (state) =>
    state.field(conflictBlocksField).length > 0
        ? conflictPanelConstructor
        : null
);

export const conflictExtensions = [
    conflictBlocksField,
    conflictDecorationsField,
    conflictPanel,
];
