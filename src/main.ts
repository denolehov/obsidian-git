import { Errors } from "isomorphic-git";
import {
    debounce,
    Debouncer,
    EventRef,
    MarkdownView,
    Menu,
    normalizePath,
    Notice,
    Platform,
    Plugin,
    TAbstractFile,
    TFile,
    WorkspaceLeaf,
} from "obsidian";
import { LineAuthoringFeature } from "src/lineAuthor/lineAuthorIntegration";
import { pluginRef } from "src/pluginGlobalRef";
import { PromiseQueue } from "src/promiseQueue";
import { ObsidianGitSettingsTab } from "src/setting/settings";
import { StatusBar } from "src/statusBar";
import { ChangedFilesModal } from "src/ui/modals/changedFilesModal";
import { CustomMessageModal } from "src/ui/modals/customMessageModal";
import {
    DEFAULT_SETTINGS,
    DIFF_VIEW_CONFIG,
    HISTORY_VIEW_CONFIG,
    SOURCE_CONTROL_VIEW_CONFIG,
} from "./constants";
import { GitManager } from "./gitManager/gitManager";
import { IsomorphicGit } from "./gitManager/isomorphicGit";
import { SimpleGit } from "./gitManager/simpleGit";
import { openHistoryInGitHub, openLineInGitHub } from "./openInGitHub";
import { LocalStorageSettings } from "./setting/localStorageSettings";
import {
    DiffViewState,
    FileStatusResult,
    mergeSettingsByPriority,
    ObsidianGitSettings,
    PluginState,
    Status,
    UnstagedFile,
} from "./types";
import DiffView from "./ui/diff/diffView";
import HistoryView from "./ui/history/historyView";
import { BranchModal } from "./ui/modals/branchModal";
import { GeneralModal } from "./ui/modals/generalModal";
import { IgnoreModal } from "./ui/modals/ignoreModal";
import GitView from "./ui/sourceControl/sourceControl";
import { BranchStatusBar } from "./ui/statusBar/branchStatusBar";
import { getNewLeaf, splitRemoteBranch } from "./utils";

export default class ObsidianGit extends Plugin {
    gitManager: GitManager;
    localStorage: LocalStorageSettings;
    settings: ObsidianGitSettings;
    settingsTab?: ObsidianGitSettingsTab;
    statusBar?: StatusBar;
    branchBar?: BranchStatusBar;
    state: PluginState;
    timeoutIDBackup?: number;
    timeoutIDPush?: number;
    timeoutIDPull?: number;
    lastPulledFiles: FileStatusResult[];
    gitReady = false;
    promiseQueue: PromiseQueue = new PromiseQueue();
    conflictOutputFile = "conflict-files-obsidian-git.md";
    autoBackupDebouncer: Debouncer<any, void>;
    onFileModifyEventRef?: EventRef;
    offlineMode = false;
    loading = false;
    cachedStatus: Status | undefined;
    // Used to store the path of the file that is currently shown in the diff view.
    lastDiffViewState: DiffViewState | undefined;
    openEvent: EventRef;
    modifyEvent: EventRef;
    deleteEvent: EventRef;
    createEvent: EventRef;
    renameEvent: EventRef;
    lineAuthoringFeature: LineAuthoringFeature = new LineAuthoringFeature(this);

    debRefresh: Debouncer<any, void>;

    setState(state: PluginState): void {
        this.state = state;
        this.statusBar?.display();
    }

    async updateCachedStatus(): Promise<Status> {
        this.cachedStatus = await this.gitManager.status();
        return this.cachedStatus;
    }

    async refresh() {
        const gitView = this.app.workspace.getLeavesOfType(
            SOURCE_CONTROL_VIEW_CONFIG.type
        );
        const historyView = this.app.workspace.getLeavesOfType(
            HISTORY_VIEW_CONFIG.type
        );

        if (
            this.settings.changedFilesInStatusBar ||
            gitView.length > 0 ||
            historyView.length > 0
        ) {
            this.loading = true;
            dispatchEvent(new CustomEvent("git-view-refresh"));

            await this.updateCachedStatus();
            this.loading = false;
            dispatchEvent(new CustomEvent("git-view-refresh"));
        }

        // We don't put a line authoring refresh here, as it would force a re-loading
        // of the line authoring feature - which would lead to a jumpy editor-view in the
        // ui after every rename event.
    }

    async refreshUpdatedHead() {
        this.lineAuthoringFeature.refreshLineAuthorViews();
    }

    async onload() {
        console.log("loading " + this.manifest.name + " plugin");
        pluginRef.plugin = this;

        this.localStorage = new LocalStorageSettings(this);

        this.localStorage.migrate();
        await this.loadSettings();
        this.migrateSettings();

        this.settingsTab = new ObsidianGitSettingsTab(this.app, this);
        this.addSettingTab(this.settingsTab);

        if (!this.localStorage.getPluginDisabled()) {
            this.loadPlugin();
        }
    }

    async loadPlugin() {
        addEventListener("git-refresh", this.refresh.bind(this));
        addEventListener("git-head-update", this.refreshUpdatedHead.bind(this));

        this.registerView(SOURCE_CONTROL_VIEW_CONFIG.type, (leaf) => {
            return new GitView(leaf, this);
        });
        this.registerView(HISTORY_VIEW_CONFIG.type, (leaf) => {
            return new HistoryView(leaf, this);
        });

        this.registerView(DIFF_VIEW_CONFIG.type, (leaf) => {
            return new DiffView(leaf, this);
        });

        this.lineAuthoringFeature.onLoadPlugin();

        (this.app.workspace as any).registerHoverLinkSource(
            SOURCE_CONTROL_VIEW_CONFIG.type,
            {
                display: "Git View",
                defaultMod: true,
            }
        );

        this.setRefreshDebouncer();

        this.addCommand({
            id: "edit-gitignore",
            name: "Edit .gitignore",
            callback: async () => {
                const path = this.gitManager.getVaultPath(".gitignore");
                if (!(await this.app.vault.adapter.exists(path))) {
                    this.app.vault.adapter.write(path, "");
                }
                const content = await this.app.vault.adapter.read(path);
                const modal = new IgnoreModal(this.app, content);
                const res = await modal.open();
                if (res !== undefined) {
                    await this.app.vault.adapter.write(path, res);
                    this.refresh();
                }
            },
        });
        this.addCommand({
            id: "open-git-view",
            name: "Open source control view",
            callback: async () => {
                const leafs = this.app.workspace.getLeavesOfType(
                    SOURCE_CONTROL_VIEW_CONFIG.type
                );
                let leaf: WorkspaceLeaf;
                if (leafs.length === 0) {
                    leaf = this.app.workspace.getRightLeaf(false);
                    await leaf.setViewState({
                        type: SOURCE_CONTROL_VIEW_CONFIG.type,
                    });
                } else {
                    leaf = leafs.first()!;
                }
                this.app.workspace.revealLeaf(leaf);

                dispatchEvent(new CustomEvent("git-refresh"));
            },
        });
        this.addCommand({
            id: "open-history-view",
            name: "Open history view",
            callback: async () => {
                const leafs = this.app.workspace.getLeavesOfType(
                    HISTORY_VIEW_CONFIG.type
                );
                let leaf: WorkspaceLeaf;
                if (leafs.length === 0) {
                    leaf = this.app.workspace.getRightLeaf(false);
                    await leaf.setViewState({
                        type: HISTORY_VIEW_CONFIG.type,
                    });
                } else {
                    leaf = leafs.first()!;
                }
                this.app.workspace.revealLeaf(leaf);

                dispatchEvent(new CustomEvent("git-refresh"));
            },
        });

        this.addCommand({
            id: "open-diff-view",
            name: "Open diff view",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (checking) {
                    return file !== null;
                } else {
                    getNewLeaf()?.setViewState({
                        type: DIFF_VIEW_CONFIG.type,
                        active: true,
                        state: {
                            staged: false,
                            file: this.gitManager.asRepositoryRelativePath(
                                file!.path,
                                true
                            ),
                        },
                    });
                }
            },
        });

        this.addCommand({
            id: "view-file-on-github",
            name: "Open file on GitHub",
            editorCallback: (editor, { file }) => {
                if (file)
                    return openLineInGitHub(editor, file, this.gitManager);
            },
        });

        this.addCommand({
            id: "view-history-on-github",
            name: "Open file history on GitHub",
            editorCallback: (_, { file }) => {
                if (file) return openHistoryInGitHub(file, this.gitManager);
            },
        });

        this.addCommand({
            id: "pull",
            name: "Pull",
            callback: () =>
                this.promiseQueue.addTask(() => this.pullChangesFromRemote()),
        });

        this.addCommand({
            id: "fetch",
            name: "fetch",
            callback: () => this.promiseQueue.addTask(() => this.fetch()),
        });

        this.addCommand({
            id: "switch-to-remote-branch",
            name: "Switch to remote branch",
            callback: () =>
                this.promiseQueue.addTask(() => this.switchRemoteBranch()),
        });

        this.addCommand({
            id: "add-to-gitignore",
            name: "Add file to gitignore",
            checkCallback: (checking) => {
                const file = app.workspace.getActiveFile();
                if (checking) {
                    return file !== null;
                } else {
                    app.vault.adapter
                        .append(
                            this.gitManager.getVaultPath(".gitignore"),
                            "\n" +
                                this.gitManager.asRepositoryRelativePath(
                                    file!.path,
                                    true
                                )
                        )
                        .then(() => {
                            this.refresh();
                        });
                }
            },
        });

        this.addCommand({
            id: "push",
            name: "Create backup",
            callback: () =>
                this.promiseQueue.addTask(() => this.createBackup(false)),
        });

        this.addCommand({
            id: "backup-and-close",
            name: "Create backup and close",
            callback: () =>
                this.promiseQueue.addTask(async () => {
                    await this.createBackup(false);
                    window.close();
                }),
        });

        this.addCommand({
            id: "commit-push-specified-message",
            name: "Create backup with specific message",
            callback: () =>
                this.promiseQueue.addTask(() => this.createBackup(false, true)),
        });

        this.addCommand({
            id: "commit",
            name: "Commit all changes",
            callback: () =>
                this.promiseQueue.addTask(() =>
                    this.commit({ fromAutoBackup: false })
                ),
        });

        this.addCommand({
            id: "commit-specified-message",
            name: "Commit all changes with specific message",
            callback: () =>
                this.promiseQueue.addTask(() =>
                    this.commit({
                        fromAutoBackup: false,
                        requestCustomMessage: true,
                    })
                ),
        });

        this.addCommand({
            id: "commit-staged",
            name: "Commit staged",
            callback: () =>
                this.promiseQueue.addTask(() =>
                    this.commit({
                        fromAutoBackup: false,
                        requestCustomMessage: false,
                        onlyStaged: true,
                    })
                ),
        });

        this.addCommand({
            id: "commit-staged-specified-message",
            name: "Commit staged with specific message",
            callback: () =>
                this.promiseQueue.addTask(() =>
                    this.commit({
                        fromAutoBackup: false,
                        requestCustomMessage: true,
                        onlyStaged: true,
                    })
                ),
        });

        this.addCommand({
            id: "push2",
            name: "Push",
            callback: () => this.promiseQueue.addTask(() => this.push()),
        });

        this.addCommand({
            id: "stage-current-file",
            name: "Stage current file",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (checking) {
                    return file !== null;
                } else {
                    this.promiseQueue.addTask(() => this.stageFile(file!));
                }
            },
        });

        this.addCommand({
            id: "unstage-current-file",
            name: "Unstage current file",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (checking) {
                    return file !== null;
                } else {
                    this.promiseQueue.addTask(() => this.unstageFile(file!));
                }
            },
        });

        this.addCommand({
            id: "edit-remotes",
            name: "Edit remotes",
            callback: async () => this.editRemotes(),
        });

        this.addCommand({
            id: "remove-remote",
            name: "Remove remote",
            callback: async () => this.removeRemote(),
        });

        this.addCommand({
            id: "delete-repo",
            name: "CAUTION: Delete repository",
            callback: async () => {
                const repoExists = await this.app.vault.adapter.exists(
                    `${this.settings.basePath}/.git`
                );
                if (repoExists) {
                    const modal = new GeneralModal({
                        options: ["NO", "YES"],
                        placeholder:
                            "Do you really want to delete the repository (.git directory)? This action cannot be undone.",
                        onlySelection: true,
                    });
                    const shouldDelete = (await modal.open()) === "YES";
                    if (shouldDelete) {
                        await this.app.vault.adapter.rmdir(
                            `${this.settings.basePath}/.git`,
                            true
                        );
                        new Notice(
                            "Successfully deleted repository. Reloading plugin..."
                        );
                        this.unloadPlugin();
                        this.init();
                    }
                } else {
                    new Notice("No repository found");
                }
            },
        });

        this.addCommand({
            id: "init-repo",
            name: "Initialize a new repo",
            callback: async () => this.createNewRepo(),
        });

        this.addCommand({
            id: "clone-repo",
            name: "Clone an existing remote repo",
            callback: async () => this.cloneNewRepo(),
        });

        this.addCommand({
            id: "list-changed-files",
            name: "List changed files",
            callback: async () => {
                if (!(await this.isAllInitialized())) return;

                const status = await this.gitManager.status();
                this.setState(PluginState.idle);
                if (status.changed.length + status.staged.length > 500) {
                    this.displayError("Too many changes to display");
                    return;
                }

                new ChangedFilesModal(this, status.changed).open();
            },
        });

        this.addCommand({
            id: "switch-branch",
            name: "Switch branch",
            callback: () => {
                this.switchBranch();
            },
        });

        this.addCommand({
            id: "create-branch",
            name: "Create new branch",
            callback: () => {
                this.createBranch();
            },
        });

        this.addCommand({
            id: "delete-branch",
            name: "Delete branch",
            callback: () => {
                this.deleteBranch();
            },
        });

        this.addCommand({
            id: "discard-all",
            name: "CAUTION: Discard all changes",
            callback: async () => {
                if (!(await this.isAllInitialized())) return false;
                const modal = new GeneralModal({
                    options: ["NO", "YES"],
                    placeholder:
                        "Do you want to discard all changes to tracked files? This action cannot be undone.",
                    onlySelection: true,
                });
                const shouldDiscardAll = (await modal.open()) === "YES";
                if (shouldDiscardAll) {
                    this.promiseQueue.addTask(() => this.discardAll());
                }
            },
        });

        this.addCommand({
            id: "toggle-line-author-info",
            name: "Toggle line author information",
            callback: () =>
                this.settingsTab?.configureLineAuthorShowStatus(
                    !this.settings.lineAuthor.show
                ),
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file, source) => {
                this.handleFileMenu(menu, file, source);
            })
        );

        if (this.settings.showStatusBar) {
            // init statusBar
            const statusBarEl = this.addStatusBarItem();
            this.statusBar = new StatusBar(statusBarEl, this);
            this.registerInterval(
                window.setInterval(() => this.statusBar?.display(), 1000)
            );
        }

        if (Platform.isDesktop && this.settings.showBranchStatusBar) {
            const branchStatusBarEl = this.addStatusBarItem();
            this.branchBar = new BranchStatusBar(branchStatusBarEl, this);
            this.registerInterval(
                window.setInterval(() => this.branchBar?.display(), 60000)
            );
        }

        this.app.workspace.onLayoutReady(() => this.init());
    }

    setRefreshDebouncer(): void {
        this.debRefresh?.cancel();
        this.debRefresh = debounce(
            () => {
                if (this.settings.refreshSourceControl) {
                    this.refresh();
                }
            },
            this.settings.refreshSourceControlTimer,
            true
        );
    }

    async showNotices(): Promise<void> {
        const length = 10000;
        if (
            this.manifest.id === "obsidian-git" &&
            Platform.isDesktopApp &&
            !this.settings.showedMobileNotice
        ) {
            new Notice(
                "Git is now available on mobile! Please read the plugin's README for more information.",
                length
            );
            this.settings.showedMobileNotice = true;
            await this.saveSettings();
        }
        if (this.manifest.id === "obsidian-git-isomorphic") {
            new Notice(
                "Git Mobile is now deprecated. Please uninstall it and install Git instead.",
                length
            );
        }
    }

    handleFileMenu(menu: Menu, file: TAbstractFile, source: string): void {
        if (!this.settings.showFileMenu) return;
        if (source !== "file-explorer-context-menu") {
            return;
        }
        if (!file) {
            return;
        }
        if (!this.gitReady) return;
        menu.addItem((item) => {
            item.setTitle(`Git: Stage`)
                .setIcon("plus-circle")
                .setSection("action")
                .onClick((_) => {
                    this.promiseQueue.addTask(async () => {
                        if (file instanceof TFile) {
                            await this.gitManager.stage(file.path, true);
                        } else {
                            await this.gitManager.stageAll({
                                dir: this.gitManager.asRepositoryRelativePath(
                                    file.path,
                                    true
                                ),
                            });
                        }
                        this.displayMessage(`Staged ${file.path}`);
                    });
                });
        });
        menu.addItem((item) => {
            item.setTitle(`Git: Unstage`)
                .setIcon("minus-circle")
                .setSection("action")
                .onClick((_) => {
                    this.promiseQueue.addTask(async () => {
                        if (file instanceof TFile) {
                            await this.gitManager.unstage(file.path, true);
                        } else {
                            await this.gitManager.unstageAll({
                                dir: this.gitManager.asRepositoryRelativePath(
                                    file.path,
                                    true
                                ),
                            });
                        }
                        this.displayMessage(`Unstaged ${file.path}`);
                    });
                });
        });
    }

    async migrateSettings(): Promise<void> {
        if (this.settings.mergeOnPull != undefined) {
            this.settings.syncMethod = this.settings.mergeOnPull
                ? "merge"
                : "rebase";
            this.settings.mergeOnPull = undefined;
            await this.saveSettings();
        }
        if (this.settings.autoCommitMessage === undefined) {
            this.settings.autoCommitMessage = this.settings.commitMessage;
            await this.saveSettings();
        }
        if (this.settings.gitPath != undefined) {
            this.localStorage.setGitPath(this.settings.gitPath);
            this.settings.gitPath = undefined;
            await this.saveSettings();
        }
        if (this.settings.username != undefined) {
            this.localStorage.setPassword(this.settings.username);
            this.settings.username = undefined;
            await this.saveSettings();
        }
    }

    unloadPlugin() {
        this.gitReady = false;
        dispatchEvent(new CustomEvent("git-refresh"));

        this.lineAuthoringFeature.deactivateFeature();
        this.clearAutoPull();
        this.clearAutoPush();
        this.clearAutoBackup();
        removeEventListener("git-refresh", this.refresh.bind(this));
        removeEventListener(
            "git-head-update",
            this.refreshUpdatedHead.bind(this)
        );
        this.app.workspace.offref(this.openEvent);
        this.app.metadataCache.offref(this.modifyEvent);
        this.app.metadataCache.offref(this.deleteEvent);
        this.app.metadataCache.offref(this.createEvent);
        this.app.metadataCache.offref(this.renameEvent);
        this.debRefresh.cancel();
    }

    async onunload() {
        (this.app.workspace as any).unregisterHoverLinkSource(
            SOURCE_CONTROL_VIEW_CONFIG.type
        );

        this.unloadPlugin();

        console.log("unloading " + this.manifest.name + " plugin");
    }

    async loadSettings() {
        // At first startup, `data` is `null` because data.json does not exist.
        let data = (await this.loadData()) as ObsidianGitSettings | null;
        //Check for existing settings
        if (data == undefined) {
            data = <ObsidianGitSettings>{ showedMobileNotice: true };
        }
        this.settings = mergeSettingsByPriority(DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        this.settingsTab?.beforeSaveSettings();
        await this.saveData(this.settings);
    }

    saveLastAuto(date: Date, mode: "backup" | "pull" | "push") {
        if (mode === "backup") {
            this.localStorage.setLastAutoBackup(date.toString());
        } else if (mode === "pull") {
            this.localStorage.setLastAutoPull(date.toString());
        } else if (mode === "push") {
            this.localStorage.setLastAutoPush(date.toString());
        }
    }

    loadLastAuto(): { backup: Date; pull: Date; push: Date } {
        return {
            backup: new Date(this.localStorage.getLastAutoBackup() ?? ""),
            pull: new Date(this.localStorage.getLastAutoPull() ?? ""),
            push: new Date(this.localStorage.getLastAutoPush() ?? ""),
        };
    }

    get useSimpleGit(): boolean {
        return Platform.isDesktopApp;
    }

    hasConnectivity() {
        if (navigator.onLine) return true;
        return (new Notice('No Connectivity'), false)
    }

    async init(): Promise<void> {
        this.showNotices();

        try {
            if (this.useSimpleGit) {
                this.gitManager = new SimpleGit(this);
                await (this.gitManager as SimpleGit).setGitInstance();
            } else {
                this.gitManager = new IsomorphicGit(this);
            }

            const result = await this.gitManager.checkRequirements();
            switch (result) {
                case "missing-git":
                    this.displayError("Cannot run git command");
                    break;
                case "missing-repo":
                    new Notice(
                        "Can't find a valid git repository. Please create one via the given command or clone an existing repo.",
                        10000
                    );
                    break;
                case "valid":
                    this.gitReady = true;
                    this.setState(PluginState.idle);

                    this.openEvent = this.app.workspace.on(
                        "active-leaf-change",
                        (leaf) => this.handleViewActiveState(leaf)
                    );

                    this.modifyEvent = this.app.vault.on("modify", () => {
                        this.debRefresh();
                    });
                    this.deleteEvent = this.app.vault.on("delete", () => {
                        this.debRefresh();
                    });
                    this.createEvent = this.app.vault.on("create", () => {
                        this.debRefresh();
                    });
                    this.renameEvent = this.app.vault.on("rename", () => {
                        this.debRefresh();
                    });

                    this.registerEvent(this.modifyEvent);
                    this.registerEvent(this.deleteEvent);
                    this.registerEvent(this.createEvent);
                    this.registerEvent(this.renameEvent);

                    this.branchBar?.display();

                    this.lineAuthoringFeature.conditionallyActivateBySettings();

                    dispatchEvent(new CustomEvent("git-refresh"));

                    if (this.settings.autoPullOnBoot) {
                        this.promiseQueue.addTask(() =>
                            this.pullChangesFromRemote()
                        );
                    }
                    this.setUpAutos();
                    break;
                default:
                    console.log(
                        "Something weird happened. The 'checkRequirements' result is " +
                            result
                    );
            }
        } catch (error) {
            this.displayError(error);
            console.error(error);
        }
    }

    async createNewRepo() {
        await this.gitManager.init();
        new Notice("Initialized new repo");
        await this.init();
    }

    async cloneNewRepo() {
        const modal = new GeneralModal({ placeholder: "Enter remote URL" });
        const url = await modal.open();
        if (url) {
            const confirmOption = "Vault Root";
            let dir = await new GeneralModal({
                options:
                    this.gitManager instanceof IsomorphicGit
                        ? [confirmOption]
                        : [],
                placeholder:
                    "Enter directory for clone. It needs to be empty or not existent.",
                allowEmpty: this.gitManager instanceof IsomorphicGit,
            }).open();
            if (dir !== undefined) {
                if (dir === confirmOption) {
                    dir = ".";
                }

                dir = normalizePath(dir);
                if (dir === "/") {
                    dir = ".";
                }

                if (dir === ".") {
                    const modal = new GeneralModal({
                        options: ["NO", "YES"],
                        placeholder: `Does your remote repo contain a ${app.vault.configDir} directory at the root?`,
                        onlySelection: true,
                    });
                    const containsConflictDir = await modal.open();
                    if (containsConflictDir === undefined) {
                        new Notice("Aborted clone");
                        return;
                    } else if (containsConflictDir === "YES") {
                        const confirmOption =
                            "DELETE ALL YOUR LOCAL CONFIG AND PLUGINS";
                        const modal = new GeneralModal({
                            options: ["Abort clone", confirmOption],
                            placeholder: `To avoid conflicts, the local ${app.vault.configDir} directory needs to be deleted.`,
                            onlySelection: true,
                        });
                        const shouldDelete =
                            (await modal.open()) === confirmOption;
                        if (shouldDelete) {
                            await this.app.vault.adapter.rmdir(
                                app.vault.configDir,
                                true
                            );
                        } else {
                            new Notice("Aborted clone");
                            return;
                        }
                    }
                }
                const depth = await new GeneralModal({
                    placeholder:
                        "Specify depth of clone. Leave empty for full clone.",
                    allowEmpty: true,
                }).open();
                let depthInt = undefined;
                if (depth !== "") {
                    depthInt = parseInt(depth);
                    if (isNaN(depthInt)) {
                        new Notice("Invalid depth. Aborting clone.");
                        return;
                    }
                }
                new Notice(`Cloning new repo into "${dir}"`);
                const oldBase = this.settings.basePath;
                const customDir = dir && dir !== ".";
                //Set new base path before clone to ensure proper .git/index file location in isomorphic-git
                if (customDir) {
                    this.settings.basePath = dir;
                }
                try {
                    await this.gitManager.clone(url, dir, depthInt);
                } catch (error) {
                    this.settings.basePath = oldBase;
                    this.saveSettings();
                    throw error;
                }
                new Notice("Cloned new repo.");
                new Notice("Please restart Obsidian");

                if (customDir) {
                    this.saveSettings();
                }
            }
        }
    }

    /**
     * Retries to call `this.init()` if necessary, otherwise returns directly
     * @returns true if `this.gitManager` is ready to be used, false if not.
     */
    async isAllInitialized(): Promise<boolean> {
        if (!this.gitReady) {
            await this.init();
        }
        return this.gitReady;
    }

    ///Used for command
    async pullChangesFromRemote(): Promise<void> {
        if (!(await this.isAllInitialized())) return;
        if (!(this.hasConnectivity())) return;

        const filesUpdated = await this.pull();
        this.setUpAutoBackup();
        if (!filesUpdated) {
            this.displayMessage("Everything is up-to-date");
        }

        if (this.gitManager instanceof SimpleGit) {
            const status = await this.gitManager.status();
            if (status.conflicted.length > 0) {
                this.displayError(
                    `You have conflicts in ${status.conflicted.length} ${
                        status.conflicted.length == 1 ? "file" : "files"
                    }`
                );
                this.handleConflict(status.conflicted);
            }
        }

        dispatchEvent(new CustomEvent("git-refresh"));
        this.setState(PluginState.idle);
    }

    async createBackup(
        fromAutoBackup: boolean,
        requestCustomMessage = false,
        commitMessage?: string
    ): Promise<void> {
        if (!(await this.isAllInitialized())) return;

        const isConnected = this.hasConnectivity();

        if (
            this.settings.syncMethod == "reset" &&
            this.settings.pullBeforePush
        ) {
            if (!isConnected) return;
            await this.pull();
        }

        if (
            !(await this.commit({
                fromAutoBackup,
                requestCustomMessage,
                commitMessage,
            }))
        )
            return;

        if (!this.settings.disablePush) {
            // Prevent plugin to pull/push at every call of createBackup. Only if unpushed commits are present
            if (await this.gitManager.canPush()) {
                if (!isConnected) return;
                if (
                    this.settings.syncMethod != "reset" &&
                    this.settings.pullBeforePush
                ) {
                    await this.pull();
                }

                await this.push();
            } else {
                this.displayMessage("No changes to push");
            }
        }
        this.setState(PluginState.idle);
    }

    // Returns true if commit was successfully
    async commit({
        fromAutoBackup,
        requestCustomMessage = false,
        onlyStaged = false,
        commitMessage,
    }: {
        fromAutoBackup: boolean;
        requestCustomMessage?: boolean;
        onlyStaged?: boolean;
        commitMessage?: string;
    }): Promise<boolean> {
        if (!(await this.isAllInitialized())) return false;

        let hadConflict = this.localStorage.getConflict();

        let changedFiles: { vault_path: string }[];
        let status: Status | undefined;
        let unstagedFiles: UnstagedFile[] | undefined;

        if (this.gitManager instanceof SimpleGit) {
            this.mayDeleteConflictFile();
            status = await this.updateCachedStatus();

            //Should not be necessary, but just in case
            if (status.conflicted.length == 0) {
                this.localStorage.setConflict(false);
                hadConflict = false;
            }

            // check for conflict files on auto backup
            if (fromAutoBackup && status.conflicted.length > 0) {
                this.displayError(
                    `Did not commit, because you have conflicts in ${
                        status.conflicted.length
                    } ${
                        status.conflicted.length == 1 ? "file" : "files"
                    }. Please resolve them and commit per command.`
                );
                this.handleConflict(status.conflicted);
                return false;
            }
            changedFiles = [...status.changed, ...status.staged];
        } else if (fromAutoBackup && hadConflict) {
            this.setState(PluginState.conflicted);
            this.displayError(
                `Did not commit, because you have conflicts. Please resolve them and commit per command.`
            );
            return false;
        } else if (hadConflict) {
            await this.mayDeleteConflictFile();
            status = await this.updateCachedStatus();
            changedFiles = [...status.changed, ...status.staged];
        } else {
            if (onlyStaged) {
                changedFiles = await (
                    this.gitManager as IsomorphicGit
                ).getStagedFiles();
            } else {
                unstagedFiles = await (
                    this.gitManager as IsomorphicGit
                ).getUnstagedFiles();
                changedFiles = unstagedFiles.map(({ filepath }) => ({
                    vault_path: this.gitManager.getVaultPath(filepath),
                }));
            }
        }

        if (await this.hasTooBigFiles(changedFiles)) {
            this.setState(PluginState.idle);
            return false;
        }

        if (changedFiles.length !== 0 || hadConflict) {
            let cmtMessage = (commitMessage ??= fromAutoBackup
                ? this.settings.autoCommitMessage
                : this.settings.commitMessage);
            if (
                (fromAutoBackup && this.settings.customMessageOnAutoBackup) ||
                requestCustomMessage
            ) {
                if (!this.settings.disablePopups && fromAutoBackup) {
                    new Notice(
                        "Auto backup: Please enter a custom commit message. Leave empty to abort"
                    );
                }
                const tempMessage = await new CustomMessageModal(
                    this,
                    true
                ).open();

                if (
                    tempMessage != undefined &&
                    tempMessage != "" &&
                    tempMessage != "..."
                ) {
                    cmtMessage = tempMessage;
                } else {
                    this.setState(PluginState.idle);
                    return false;
                }
            }
            let committedFiles: number | undefined;
            if (onlyStaged) {
                committedFiles = await this.gitManager.commit(cmtMessage);
            } else {
                committedFiles = await this.gitManager.commitAll({
                    message: cmtMessage,
                    status,
                    unstagedFiles,
                });
            }

            //Handle resolved conflict after commit
            if (this.gitManager instanceof SimpleGit) {
                if ((await this.updateCachedStatus()).conflicted.length == 0) {
                    this.localStorage.setConflict(false);
                }
            }

            let roughly = false;
            if (committedFiles === undefined) {
                roughly = true;
                committedFiles = changedFiles.length;
            }
            this.setUpAutoBackup();
            this.displayMessage(
                `Committed${roughly ? " approx." : ""} ${committedFiles} ${
                    committedFiles == 1 ? "file" : "files"
                }`
            );
        } else {
            this.displayMessage("No changes to commit");
        }
        dispatchEvent(new CustomEvent("git-refresh"));

        this.setState(PluginState.idle);
        return true;
    }

    async hasTooBigFiles(files: { vault_path: string }[]): Promise<boolean> {
        const branchInfo = await this.gitManager.branchInfo();
        const remote = branchInfo.tracking
            ? splitRemoteBranch(branchInfo.tracking)[0]
            : null;

        if (remote) {
            const remoteUrl = await this.gitManager.getRemoteUrl(remote);

            //Check for files >100mb on GitHub remote
            if (remoteUrl?.includes("github.com")) {
                const tooBigFiles = files.filter((f) => {
                    const file = this.app.vault.getAbstractFileByPath(
                        f.vault_path
                    );
                    if (file instanceof TFile) {
                        return file.stat.size >= 100000000;
                    }
                    return false;
                });
                if (tooBigFiles.length > 0) {
                    this.displayError(
                        `Did not commit, because following files are too big: ${tooBigFiles.map(
                            (e) => e.vault_path
                        )}. Please remove them.`
                    );

                    return true;
                }
            }
        }
        return false;
    }

    async push(): Promise<boolean> {
        if (!(await this.isAllInitialized())) return false;
        if (!(await this.remotesAreSet())) return false;
        if (!(this.hasConnectivity())) return false;

        const hadConflict = this.localStorage.getConflict();
        if (this.gitManager instanceof SimpleGit)
            await this.mayDeleteConflictFile();

        // Refresh because of pull
        let status: any;
        if (
            this.gitManager instanceof SimpleGit &&
            (status = await this.updateCachedStatus()).conflicted.length > 0
        ) {
            this.displayError(
                `Cannot push. You have conflicts in ${
                    status.conflicted.length
                } ${status.conflicted.length == 1 ? "file" : "files"}`
            );
            this.handleConflict(status.conflicted);
            return false;
        } else if (this.gitManager instanceof IsomorphicGit && hadConflict) {
            this.displayError(`Cannot push. You have conflicts`);
            this.setState(PluginState.conflicted);
            return false;
        }
        {
            console.log("Pushing....");
            const pushedFiles = await this.gitManager.push();
            console.log("Pushed!", pushedFiles);
            if (pushedFiles > 0) {
                this.displayMessage(
                    `Pushed ${pushedFiles} ${
                        pushedFiles == 1 ? "file" : "files"
                    } to remote`
                );
            } else {
                this.displayMessage(`No changes to push`);
            }
            this.offlineMode = false;
            this.setState(PluginState.idle);
            dispatchEvent(new CustomEvent("git-refresh"));

            return true;
        }
    }

    /// Used for internals
    /// Returns whether the pull added a commit or not.
    async pull(): Promise<boolean> {
        if (!(await this.remotesAreSet())) {
            return false;
        }
        const pulledFiles = (await this.gitManager.pull()) || [];
        this.offlineMode = false;

        if (pulledFiles.length > 0) {
            this.displayMessage(
                `Pulled ${pulledFiles.length} ${
                    pulledFiles.length == 1 ? "file" : "files"
                } from remote`
            );
            this.lastPulledFiles = pulledFiles;
        }
        return pulledFiles.length != 0;
    }

    async fetch(): Promise<void> {
        if (!(await this.remotesAreSet())) {
            return;
        }
        await this.gitManager.fetch();

        this.displayMessage(`Fetched from remote`);
        this.offlineMode = false;
        dispatchEvent(new CustomEvent("git-refresh"));
    }

    async mayDeleteConflictFile(): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(
            this.conflictOutputFile
        );
        if (file) {
            this.app.workspace.iterateAllLeaves((leaf) => {
                if (
                    leaf.view instanceof MarkdownView &&
                    leaf.view.file?.path == file.path
                ) {
                    leaf.detach();
                }
            });
            await this.app.vault.delete(file);
        }
    }

    async stageFile(file: TFile): Promise<boolean> {
        if (!(await this.isAllInitialized())) return false;

        await this.gitManager.stage(file.path, true);
        this.displayMessage(`Staged ${file.path}`);

        dispatchEvent(new CustomEvent("git-refresh"));

        this.setState(PluginState.idle);
        return true;
    }

    async unstageFile(file: TFile): Promise<boolean> {
        if (!(await this.isAllInitialized())) return false;

        await this.gitManager.unstage(file.path, true);
        this.displayMessage(`Unstaged ${file.path}`);

        dispatchEvent(new CustomEvent("git-refresh"));

        this.setState(PluginState.idle);
        return true;
    }

    async switchBranch(): Promise<string | undefined> {
        if (!(await this.isAllInitialized())) return;

        const branchInfo = await this.gitManager.branchInfo();
        const selectedBranch = await new BranchModal(
            branchInfo.branches
        ).open();

        if (selectedBranch != undefined) {
            await this.gitManager.checkout(selectedBranch);
            this.displayMessage(`Switched to ${selectedBranch}`);
            this.branchBar?.display();
            return selectedBranch;
        }
    }

    async switchRemoteBranch(): Promise<string | undefined> {
        if (!(await this.isAllInitialized())) return;

        const selectedBranch = (await this.selectRemoteBranch()) || "";

        const [remote, branch] = splitRemoteBranch(selectedBranch);

        if (branch != undefined && remote != undefined) {
            await this.gitManager.checkout(branch, remote);
            this.displayMessage(`Switched to ${selectedBranch}`);
            this.branchBar?.display();
            return selectedBranch;
        }
    }

    async createBranch(): Promise<string | undefined> {
        if (!(await this.isAllInitialized())) return;

        const newBranch = await new GeneralModal({
            placeholder: "Create new branch",
        }).open();
        if (newBranch != undefined) {
            await this.gitManager.createBranch(newBranch);
            this.displayMessage(`Created new branch ${newBranch}`);
            this.branchBar?.display();
            return newBranch;
        }
    }

    async deleteBranch(): Promise<string | undefined> {
        if (!(await this.isAllInitialized())) return;

        const branchInfo = await this.gitManager.branchInfo();
        if (branchInfo.current) branchInfo.branches.remove(branchInfo.current);
        const branch = await new GeneralModal({
            options: branchInfo.branches,
            placeholder: "Delete branch",
            onlySelection: true,
        }).open();
        if (branch != undefined) {
            let force = false;
            const merged = await this.gitManager.branchIsMerged(branch);
            // Using await inside IF throws exception
            if (!merged) {
                const forceAnswer = await new GeneralModal({
                    options: ["YES", "NO"],
                    placeholder:
                        "This branch isn't merged into HEAD. Force delete?",
                    onlySelection: true,
                }).open();
                if (forceAnswer !== "YES") {
                    return;
                }
                force = forceAnswer === "YES";
            }
            await this.gitManager.deleteBranch(branch, force);
            this.displayMessage(`Deleted branch ${branch}`);
            this.branchBar?.display();
            return branch;
        }
    }

    async remotesAreSet(): Promise<boolean> {
        if (!(await this.gitManager.branchInfo()).tracking) {
            new Notice("No upstream branch is set. Please select one.");
            const remoteBranch = await this.selectRemoteBranch();

            if (remoteBranch == undefined) {
                this.displayError("Aborted. No upstream-branch is set!", 10000);
                this.setState(PluginState.idle);
                return false;
            } else {
                await this.gitManager.updateUpstreamBranch(remoteBranch);
                return true;
            }
        }
        return true;
    }

    async setUpAutoBackup() {
        if (this.settings.setLastSaveToLastCommit) {
            this.clearAutoBackup();
            const lastCommitDate = await this.gitManager.getLastCommitTime();
            if (lastCommitDate) {
                this.localStorage.setLastAutoBackup(lastCommitDate.toString());
            }
        }

        if (!this.timeoutIDBackup && !this.onFileModifyEventRef) {
            const lastAutos = this.loadLastAuto();

            if (this.settings.autoSaveInterval > 0) {
                const now = new Date();

                const diff =
                    this.settings.autoSaveInterval -
                    Math.round(
                        (now.getTime() - lastAutos.backup.getTime()) / 1000 / 60
                    );
                this.startAutoBackup(diff <= 0 ? 0 : diff);
            }
        }
    }

    async setUpAutos() {
        this.setUpAutoBackup();
        const lastAutos = this.loadLastAuto();

        if (
            this.settings.differentIntervalCommitAndPush &&
            this.settings.autoPushInterval > 0
        ) {
            const now = new Date();

            const diff =
                this.settings.autoPushInterval -
                Math.round(
                    (now.getTime() - lastAutos.push.getTime()) / 1000 / 60
                );
            this.startAutoPush(diff <= 0 ? 0 : diff);
        }
        if (this.settings.autoPullInterval > 0) {
            const now = new Date();

            const diff =
                this.settings.autoPullInterval -
                Math.round(
                    (now.getTime() - lastAutos.pull.getTime()) / 1000 / 60
                );
            this.startAutoPull(diff <= 0 ? 0 : diff);
        }
    }

    async discardAll() {
        await this.gitManager.discardAll({
            status: this.cachedStatus,
        });
        new Notice(
            "All local changes have been discarded. New files remain untouched."
        );
    }

    clearAutos(): void {
        this.clearAutoBackup();
        this.clearAutoPush();
        this.clearAutoPull();
    }

    startAutoBackup(minutes?: number) {
        let time = (minutes ?? this.settings.autoSaveInterval) * 60000;
        if (this.settings.autoBackupAfterFileChange) {
            if (minutes === 0) {
                this.doAutoBackup();
            } else {
                this.onFileModifyEventRef = this.app.vault.on("modify", () =>
                    this.autoBackupDebouncer()
                );
                this.autoBackupDebouncer = debounce(
                    () => this.doAutoBackup(),
                    time,
                    true
                );
            }
        } else {
            // max timeout in js
            if (time > 2147483647) time = 2147483647;
            this.timeoutIDBackup = window.setTimeout(
                () => this.doAutoBackup(),
                time
            );
        }
    }

    // This is used for both auto backup and commit
    doAutoBackup(): void {
        this.promiseQueue.addTask(() => {
            if (this.settings.differentIntervalCommitAndPush) {
                return this.commit({ fromAutoBackup: true });
            } else {
                return this.createBackup(true);
            }
        });
        this.saveLastAuto(new Date(), "backup");
        this.saveSettings();
        this.startAutoBackup();
    }

    startAutoPull(minutes?: number) {
        let time = (minutes ?? this.settings.autoPullInterval) * 60000;
        // max timeout in js
        if (time > 2147483647) time = 2147483647;

        this.timeoutIDPull = window.setTimeout(() => {
            this.promiseQueue.addTask(() => this.pullChangesFromRemote());
            this.saveLastAuto(new Date(), "pull");
            this.saveSettings();
            this.startAutoPull();
        }, time);
    }

    startAutoPush(minutes?: number) {
        let time = (minutes ?? this.settings.autoPushInterval) * 60000;
        // max timeout in js
        if (time > 2147483647) time = 2147483647;

        this.timeoutIDPush = window.setTimeout(() => {
            this.promiseQueue.addTask(() => this.push());
            this.saveLastAuto(new Date(), "push");
            this.saveSettings();
            this.startAutoPush();
        }, time);
    }

    clearAutoBackup(): boolean {
        let wasActive = false;
        if (this.timeoutIDBackup) {
            window.clearTimeout(this.timeoutIDBackup);
            this.timeoutIDBackup = undefined;
            wasActive = true;
        }
        if (this.onFileModifyEventRef) {
            this.autoBackupDebouncer?.cancel();
            this.app.vault.offref(this.onFileModifyEventRef);
            this.onFileModifyEventRef = undefined;
            wasActive = true;
        }
        return wasActive;
    }

    clearAutoPull(): boolean {
        if (this.timeoutIDPull) {
            window.clearTimeout(this.timeoutIDPull);
            this.timeoutIDPull = undefined;
            return true;
        }
        return false;
    }

    clearAutoPush(): boolean {
        if (this.timeoutIDPush) {
            window.clearTimeout(this.timeoutIDPush);
            this.timeoutIDPush = undefined;
            return true;
        }
        return false;
    }

    async handleConflict(conflicted?: string[]): Promise<void> {
        this.setState(PluginState.conflicted);

        this.localStorage.setConflict(true);
        let lines: string[] | undefined;
        if (conflicted !== undefined) {
            lines = [
                "# Conflicts",
                "Please resolve them and commit them using the commands `Git: Commit all changes` followed by `Git: Push`",
                "(This file will automatically be deleted before commit)",
                "[[#Additional Instructions]] available below file list",
                "",
                ...conflicted.map((e) => {
                    const file = this.app.vault.getAbstractFileByPath(e);
                    if (file instanceof TFile) {
                        const link = this.app.metadataCache.fileToLinktext(
                            file,
                            "/"
                        );
                        return `- [[${link}]]`;
                    } else {
                        return `- Not a file: ${e}`;
                    }
                }),
                `
# Additional Instructions
I strongly recommend to use "Source mode" for viewing the conflicted files. For simple conflicts, in each file listed above replace every occurrence of the following text blocks with the desired text.

\`\`\`diff
<<<<<<< HEAD
    File changes in local repository
=======
    File changes in remote repository
>>>>>>> origin/main
\`\`\``,
            ];
        }
        this.writeAndOpenFile(lines?.join("\n"));
    }

    async editRemotes(): Promise<string | undefined> {
        if (!(await this.isAllInitialized())) return;

        const remotes = await this.gitManager.getRemotes();

        const nameModal = new GeneralModal({
            options: remotes,
            placeholder:
                "Select or create a new remote by typing its name and selecting it",
        });
        const remoteName = await nameModal.open();

        if (remoteName) {
            const oldUrl = await this.gitManager.getRemoteUrl(remoteName);
            const urlModal = new GeneralModal({ initialValue: oldUrl });
            // urlModal.inputEl.setText(oldUrl ?? "");
            const remoteURL = await urlModal.open();
            if (remoteURL) {
                await this.gitManager.setRemote(remoteName, remoteURL);
                return remoteName;
            }
        }
    }

    async selectRemoteBranch(): Promise<string | undefined> {
        let remotes = await this.gitManager.getRemotes();
        let selectedRemote: string | undefined;
        if (remotes.length === 0) {
            selectedRemote = await this.editRemotes();
            if (selectedRemote == undefined) {
                remotes = await this.gitManager.getRemotes();
            }
        }

        const nameModal = new GeneralModal({
            options: remotes,
            placeholder:
                "Select or create a new remote by typing its name and selecting it",
        });
        const remoteName = selectedRemote ?? (await nameModal.open());

        if (remoteName) {
            this.displayMessage("Fetching remote branches");
            await this.gitManager.fetch(remoteName);
            const branches = await this.gitManager.getRemoteBranches(
                remoteName
            );
            const branchModal = new GeneralModal({
                options: branches,
                placeholder:
                    "Select or create a new remote branch by typing its name and selecting it",
            });
            return await branchModal.open();
        }
    }

    async removeRemote() {
        if (!(await this.isAllInitialized())) return;

        const remotes = await this.gitManager.getRemotes();

        const nameModal = new GeneralModal({
            options: remotes,
            placeholder: "Select a remote",
        });
        const remoteName = await nameModal.open();

        if (remoteName) {
            this.gitManager.removeRemote(remoteName);
        }
    }

    async writeAndOpenFile(text?: string) {
        if (text !== undefined) {
            await this.app.vault.adapter.write(this.conflictOutputFile, text);
        }
        let fileIsAlreadyOpened = false;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (
                leaf.getDisplayText() != "" &&
                this.conflictOutputFile.startsWith(leaf.getDisplayText())
            ) {
                fileIsAlreadyOpened = true;
            }
        });
        if (!fileIsAlreadyOpened) {
            this.app.workspace.openLinkText(this.conflictOutputFile, "/", true);
        }
    }

    handleViewActiveState(leaf: WorkspaceLeaf | null): void {
        // Prevent removing focus when switching to other panes than file panes like search or GitView
        if (!leaf?.view.getState().file) return;

        const sourceControlLeaf = this.app.workspace
            .getLeavesOfType(SOURCE_CONTROL_VIEW_CONFIG.type)
            .first();
        const historyLeaf = this.app.workspace
            .getLeavesOfType(HISTORY_VIEW_CONFIG.type)
            .first();

        // Clear existing active state
        sourceControlLeaf?.view.containerEl
            .querySelector(`div.nav-file-title.is-active`)
            ?.removeClass("is-active");
        historyLeaf?.view.containerEl
            .querySelector(`div.nav-file-title.is-active`)
            ?.removeClass("is-active");

        if (leaf?.view instanceof DiffView) {
            const path = leaf.view.state.file;
            this.lastDiffViewState = leaf.view.getState();
            let el: Element | undefined | null;
            if (sourceControlLeaf && leaf.view.state.staged) {
                el = sourceControlLeaf.view.containerEl.querySelector(
                    `div.staged div.nav-file-title[data-path='${path}']`
                );
            } else if (
                sourceControlLeaf &&
                leaf.view.state.staged === false &&
                !leaf.view.state.hash
            ) {
                el = sourceControlLeaf.view.containerEl.querySelector(
                    `div.changes div.nav-file-title[data-path='${path}']`
                );
            } else if (historyLeaf && leaf.view.state.hash) {
                el = historyLeaf.view.containerEl.querySelector(
                    `div.nav-file-title[data-path='${path}']`
                );
            }
            el?.addClass("is-active");
        } else {
            this.lastDiffViewState = undefined;
        }
    }

    // region: displaying / formatting messages
    displayMessage(message: string, timeout: number = 4 * 1000): void {
        this.statusBar?.displayMessage(message.toLowerCase(), timeout);

        if (!this.settings.disablePopups) {
            new Notice(message, 5 * 1000);
        }

        console.log(`git obsidian message: ${message}`);
    }
    displayError(message: any, timeout: number = 10 * 1000): void {
        if (message instanceof Errors.UserCanceledError) {
            new Notice("Aborted");
            return;
        }
        // Some errors might not be of type string
        message = message.toString();
        new Notice(message, timeout);
        console.log(`git obsidian error: ${message}`);
        this.statusBar?.displayMessage(message.toLowerCase(), timeout);
    }
}
