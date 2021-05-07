import ObsidianGit from "./main";
import { PluginState } from "./types";

interface StatusBarMessage {
    message: string;
    timeout: number;
}

export class StatusBar {
    public messages: StatusBarMessage[] = [];
    public currentMessage: StatusBarMessage;
    public lastMessageTimestamp: number;

    private statusBarEl: HTMLElement;
    private plugin: ObsidianGit;

    constructor(statusBarEl: HTMLElement, plugin: ObsidianGit) {
        this.statusBarEl = statusBarEl;
        this.plugin = plugin;
    }

    public displayMessage(message: string, timeout: number) {
        this.messages.push({
            message: `git: ${message.slice(0, 100)}`,
            timeout: timeout,
        });
        this.display();
    }

    public display() {
        if (this.messages.length > 0 && !this.currentMessage) {
            this.currentMessage = this.messages.shift();
            this.statusBarEl.setText(this.currentMessage.message);
            this.lastMessageTimestamp = Date.now();
        } else if (this.currentMessage) {
            const messageAge = Date.now() - this.lastMessageTimestamp;
            if (messageAge >= this.currentMessage.timeout) {
                this.currentMessage = null;
                this.lastMessageTimestamp = null;
            }
        } else {
            this.displayState();
        }
    }

    private displayState() {
        switch (this.plugin.state) {
            case PluginState.idle:
                this.displayFromNow(this.plugin.lastUpdate);
                break;
            case PluginState.status:
                this.statusBarEl.setText("git: checking repo status..");
                break;
            case PluginState.add:
                this.statusBarEl.setText("git: adding files to repo..");
                break;
            case PluginState.commit:
                this.statusBarEl.setText("git: committing changes..");
                break;
            case PluginState.push:
                this.statusBarEl.setText("git: pushing changes..");
                break;
            case PluginState.pull:
                this.statusBarEl.setText("git: pulling changes..");
                break;
            case PluginState.conflicted:
                this.statusBarEl.setText("git: you have conflict files..");
                break;
            default:
                this.statusBarEl.setText("git: failed on initialization!");
                break;
        }
    }

    private displayFromNow(timestamp: number): void {
        if (timestamp) {
            let moment = (window as any).moment;
            let fromNow = moment(timestamp).fromNow();
            this.statusBarEl.setText(`git: last update ${fromNow}..`);
        } else {
            this.statusBarEl.setText(`git: ready`);
        }
    }
}