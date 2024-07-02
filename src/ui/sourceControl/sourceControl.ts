import { HoverParent, HoverPopover, ItemView, WorkspaceLeaf } from "obsidian";
import { SOURCE_CONTROL_VIEW_CONFIG } from "src/constants";
import ObsidianGit from "src/main";
import SourceControlViewComponent from "./sourceControl.svelte";

export default class GitView extends ItemView implements HoverParent {
    plugin: ObsidianGit;
    private _view: SourceControlViewComponent;
    hoverPopover: HoverPopover | null;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianGit) {
        super(leaf);
        this.plugin = plugin;
        this.hoverPopover = null;
    }

    getViewType(): string {
        return SOURCE_CONTROL_VIEW_CONFIG.type;
    }

    getDisplayText(): string {
        return SOURCE_CONTROL_VIEW_CONFIG.name;
    }

    getIcon(): string {
        return SOURCE_CONTROL_VIEW_CONFIG.icon;
    }

    onClose(): Promise<void> {
        return super.onClose();
    }

    onOpen(): Promise<void> {
        this._view = new SourceControlViewComponent({
            target: this.contentEl,
            props: {
                plugin: this.plugin,
                view: this,
            },
        });
        return super.onOpen();
    }
}
