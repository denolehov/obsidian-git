export interface ObsidianGitSettings {
    commitMessage: string;
    commitDateFormat: string;
    autoSaveInterval: number;
    autoPullInterval: number;
    autoPullOnBoot: boolean;
    disablePush: boolean;
    pullBeforePush: boolean;
    disablePopups: boolean;
    listChangedFilesInMessageBody: boolean;
    standaloneMode: boolean;
    proxyURL: string;
    showStatusBar: boolean;
    lastAutoBackUp: string;
    lastAutoPull: string;
}

export interface Author {
    name: string;
    email: string;
}
export interface Status {
    changed: FileStatusResult[];
    staged: string[];
}
export interface FileStatusResult {
    path: string;
    index: string;
}
export interface DiffResult {
    path: string;
    type: "equal" | "modify" | "add" | "remove";
}

export enum PluginState {
    idle,
    status,
    pull,
    add,
    commit,
    push,
    conflicted,
}

export interface BranchInfo {
    current: string;
    tracking: string;
    branches: string[];
}