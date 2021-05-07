import { Notice, Plugin, TFile } from "obsidian";
import { GitManager } from "./gitManager";
import { IsomorphicGit } from "./isomorphicGit";
import { ChangedFilesModal } from "./modals/changedFilesModal";
import { CustomMessageModal } from "./modals/customMessageModal";
import { PromiseQueue } from "./promiseQueue";
import { ObsidianGitSettingsTab } from "./settingsPane";
import { SimpleGit } from "./simpleGit";
import { StatusBar } from "./statusBar";
import { ObsidianGitSettings, PluginState } from "./types";

const DEFAULT_SETTINGS: ObsidianGitSettings = {
    commitMessage: "vault backup: {{date}}",
    commitDateFormat: "YYYY-MM-DD HH:mm:ss",
    autoSaveInterval: 0,
    autoPullInterval: 0,
    autoPullOnBoot: false,
    disablePush: false,
    pullBeforePush: true,
    disablePopups: false,
    listChangedFilesInMessageBody: false,
    standaloneMode: false,
    proxyURL: "",
    showStatusBar: true,
    lastAutoBackUp: "",
    lastAutoPull: ""
};

export default class ObsidianGit extends Plugin {
    gitManager: GitManager;
    settings: ObsidianGitSettings;
    statusBar: StatusBar | undefined;
    state: PluginState;
    timeoutIDBackup: number;
    timeoutIDPull: number;
    lastUpdate: number;
    gitReady = false;
    promiseQueue: PromiseQueue = new PromiseQueue();
    readonly conflictOutputFile = "conflict-files-obsidian-git.md";

    setState(state: PluginState) {
        this.state = state;
        this.statusBar?.display();
    }

    async onload() {
        console.log('loading ' + this.manifest.name + " plugin");
        await this.loadSettings();

        this.addSettingTab(new ObsidianGitSettingsTab(this));

        this.addCommand({
            id: "pull",
            name: "Pull from remote repository",
            callback: () => this.promiseQueue.addTask(() => this.pullChangesFromRemote()),
        });

        this.addCommand({
            id: "push",
            name: "Commit *all* changes and push to remote repository",
            callback: () => this.promiseQueue.addTask(() => this.createBackup(false))
        });

        this.addCommand({
            id: "commit-push-specified-message",
            name: "Commit and push all changes with specified message",
            callback: () => new CustomMessageModal(this).open()
        });

        this.addCommand({
            id: "list-changed-files",
            name: "List changed files",
            callback: async () => {
                if (!this.gitReady) {
                    await this.init();
                }

                if (!this.gitReady) return;
                const status = await this.gitManager.status();
                new ChangedFilesModal(this, status.changed).open();
            }
        });
        if (this.settings.showStatusBar || !(this.app as any).isMobile) {
            // init statusBar
            let statusBarEl = this.addStatusBarItem();
            this.statusBar = new StatusBar(statusBarEl, this);
            this.registerInterval(
                window.setInterval(() => this.statusBar.display(), 1000)
            );
        }

        this.init();
    }

    async onunload() {
        window.clearTimeout(this.timeoutIDBackup);
        window.clearTimeout(this.timeoutIDPull);
        console.log('unloading ' + this.manifest.name + " plugin");
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }

    async init(): Promise<void> {
        if (this.settings.standaloneMode || (this.app as any).isMobile) {
            this.gitManager = new IsomorphicGit(this);
            this.settings.standaloneMode = true;
            await this.saveSettings();
        } else {
            this.gitManager = new SimpleGit(this);
        }
        const result = await this.gitManager.checkRequirements();
        switch (result) {
            case "missing-git":
                this.displayError("Cannot run git command");
                break;
            case "missing-repo":
                new Notice("Can't find a valid git repository. Please go to the settings");
                break;
            case "wrong-settings":
                this.displayError("Not all of the required standalone mode settings are set");
            case "valid":
                this.gitReady = true;
                this.setState(PluginState.idle);
                if (this.settings.autoPullOnBoot) {
                    this.promiseQueue.addTask(() => this.pullChangesFromRemote());
                }

                if (this.settings.autoSaveInterval > 0) {
                    const now = new Date();
                    const last = new Date(this.settings.lastAutoBackUp);

                    const diff = this.settings.autoSaveInterval - (Math.round(((now.getTime() - last.getTime()) / 1000) / 60));
                    this.startAutoBackup(diff <= 0 ? 0 : diff);
                }
                if (this.settings.autoPullInterval > 0) {
                    const now = new Date();
                    const last = new Date(this.settings.lastAutoPull);

                    const diff = this.settings.autoPullInterval - (Math.round(((now.getTime() - last.getTime()) / 1000) / 60));
                    this.startAutoPull(diff <= 0 ? 0 : diff);
                }
                break;
            default:
                console.log("Something weird happened. The 'checkRequirements' result is " + result);
        }
    }

    async pullChangesFromRemote(): Promise<void> {

        if (!this.gitReady) {
            await this.init();
        }

        if (!this.gitReady) return;

        const filesUpdated = await this.gitManager.pull();
        if (filesUpdated > 0) {
            this.displayMessage(`Pulled new changes. ${filesUpdated} files updated`);
        } else {
            this.displayMessage("Everything is up-to-date");
        }

        if (this.gitManager instanceof SimpleGit) {
            const status = await this.gitManager.status();
            if (status.conflicted.length > 0) {
                this.displayError(`You have ${status.conflicted.length} conflict files`);
            }
        }
        this.setState(PluginState.idle);
    }

    async createBackup(fromAutoBackup: boolean, commitMessage?: string): Promise<void> {
        if (!this.gitReady) {
            await this.init();
        }
        if (!this.gitReady) return;

        if (!fromAutoBackup) {
            const file = this.app.vault.getAbstractFileByPath(this.conflictOutputFile);
            await this.app.vault.delete(file);
        }

        if (this.gitManager instanceof SimpleGit) {
            const status = await this.gitManager.status();
            // check for conflict files on auto backup
            if (fromAutoBackup && status.conflicted.length > 0) {
                this.setState(PluginState.idle);
                this.displayError(`Did not commit, because you have ${status.conflicted.length} conflict files. Please resolve them and commit per command.`);
                this.handleConflict(status.conflicted);
                return;
            }
        }

        const changedFiles = (await this.gitManager.status()).changed;

        if (changedFiles.length !== 0) {
            const commitedFiles = await this.gitManager.commitAll(commitMessage);
            this.displayMessage(`Committed ${commitedFiles} files`);
        } else {
            this.displayMessage("No changes to commit");
        }

        if (!this.settings.disablePush) {

            if (!(await this.gitManager.branchInfo()).tracking) {
                this.displayError("Did not push. No tracking branch is set! Please set one in the settings", 10000);
                this.setState(PluginState.idle);
                return;
            }


            // Prevent plugin to pull/push at every call of createBackup. Only if unpushed commits are present
            if (await this.gitManager.canPush()) {
                if (this.settings.pullBeforePush) {
                    const pulledFilesLength = await this.gitManager.pull();
                    if (pulledFilesLength > 0) {
                        this.displayMessage(`Pulled ${pulledFilesLength} files from remote`);
                    }
                }

                let status: any;
                if (this.gitManager instanceof SimpleGit && (status = await this.gitManager.status()).conflicted.length > 0) {
                    this.displayError(`Cannot push. You have ${status.conflicted.length} conflict files`);
                    this.handleConflict(status.conflicted);
                    return;
                } else {
                    const pushedFiles = await this.gitManager.push();
                    this.displayMessage(`Pushed ${pushedFiles} files to remote`);
                }
            } else {
                this.displayMessage("No changes to push");
            }
        }
        this.setState(PluginState.idle);
    }

    startAutoBackup(minutes?: number) {
        this.timeoutIDBackup = window.setTimeout(
            () => {
                this.promiseQueue.addTask(() => this.createBackup(true));
                this.settings.lastAutoBackUp = new Date().toString();
                this.saveSettings();
                this.startAutoBackup();
            },
            (minutes ?? this.settings.autoSaveInterval) * 60000
        );
    }

    startAutoPull(minutes?: number) {
        this.timeoutIDPull = window.setTimeout(
            () => {
                this.promiseQueue.addTask(() => this.pullChangesFromRemote());
                this.settings.lastAutoPull = new Date().toString();
                this.saveSettings();
                this.startAutoPull();
            },
            (minutes ?? this.settings.autoPullInterval) * 60000
        );
    }

    clearAutoBackup(): boolean {
        if (this.timeoutIDBackup) {
            window.clearTimeout(this.timeoutIDBackup);
            return true;
        }
        return false;
    }

    clearAutoPull(): boolean {
        if (this.timeoutIDPull) {
            window.clearTimeout(this.timeoutIDPull);
            return true;
        }
        return false;
    }

    async handleConflict(conflicted: string[]): Promise<void> {
        this.setState(PluginState.conflicted);
        const lines = [
            "# Conflict files",
            "Please resolve them and commit per command (This file will be deleted before the commit).",
            ...conflicted.map(e => {
                const file = this.app.vault.getAbstractFileByPath(e);
                if (file instanceof TFile) {
                    const link = this.app.metadataCache.fileToLinktext(file, "/");
                    return `- [[${link}]]`;
                } else {
                    return `- Not a file: ${e}`;
                }
            })
        ];
        this.writeAndOpenFile(lines.join("\n"));
    }

    async writeAndOpenFile(text: string) {
        await this.app.vault.adapter.write(this.conflictOutputFile, text);

        let fileIsAlreadyOpened = false;
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.getDisplayText() != "" && this.conflictOutputFile.startsWith(leaf.getDisplayText())) {
                fileIsAlreadyOpened = true;
            }
        });
        if (!fileIsAlreadyOpened) {
            this.app.workspace.openLinkText(this.conflictOutputFile, "/", true);
        }
    }

    displayMessage(message: string, timeout: number = 4 * 1000): void {
        this.statusBar?.displayMessage(message.toLowerCase(), timeout);

        if (!this.settings.disablePopups) {
            new Notice(message);
        }

        console.log(`git obsidian message: ${message}`);
    }
    displayError(message: any, timeout: number = 0): void {
        new Notice(message.toString());
        console.log(`git obsidian error: ${message}`);
        this.statusBar?.displayMessage(message.toString().toLowerCase(), timeout);
    }
}
