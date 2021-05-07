import { DataAdapter, normalizePath, Vault } from "obsidian";

export class MyAdapter {
    promises: any = {};
    adapter: DataAdapter;
    vault: Vault;
    constructor(vault: Vault) {
        this.adapter = vault.adapter;
        this.vault = vault;

        this.promises.readFile = this.readFile.bind(this);
        this.promises.writeFile = this.writeFile.bind(this);
        this.promises.readdir = this.readdir.bind(this);
        this.promises.mkdir = this.mkdir.bind(this);
        this.promises.rmdir = this.rmdir.bind(this);
        this.promises.stat = this.stat.bind(this);
        this.promises.unlink = this.unlink.bind(this);
        this.promises.lstat = this.lstat.bind(this);
        this.promises.readlink = this.readlink.bind(this);
        this.promises.symlink = this.symlink.bind(this);
    }
    async readFile(path: string, opts: any) {
        if (opts.encoding == "utf8") {
            return this.adapter.read(path);
        } else {
            return this.adapter.readBinary(path);
        }
    }
    async writeFile(file: string, data: any) {
        if (typeof data === "string") {
            return this.adapter.write(file, data);
        } else {
            return this.adapter.writeBinary(file, data);
        }
    }
    async readdir(path: string) {
        if (path === ".")
            path = "";
        const res = await this.adapter.list(path);
        const all = [...res.files, ...res.folders];
        let formattedAll = all.map(e => normalizePath(e.substring(path.length)));
        formattedAll = formattedAll.filter(item => !item.startsWith("."));
        formattedAll.remove("_git");

        return formattedAll;
    }
    async mkdir(path: string) {
        return this.adapter.mkdir(path);
    }
    async rmdir(path: string, opts: any) {
        return this.adapter.rmdir(path, opts?.options?.recursive ?? false);
    }
    async stat(path: string) {
        const stat = await this.adapter.stat(normalizePath(path));
        if (stat) {
            return {
                ctimeMs: stat.ctime,
                mtimeMs: stat.mtime,
                size: stat.size,
                type: stat.type === "folder" ? "directory" : stat.type,
                isFile: () => stat.type === "file",
                isDirectory: () => stat.type === "folder",
                isSymbolicLink: () => false,
            };

        } else {
            // used to determine whether a file exists or not
            throw { "code": "ENOENT" };
        }
    }
    async unlink(path: string) {
        return this.adapter.remove(path);
    }
    async lstat(path: string) {
        return this.stat(path);
    }
    async readlink() {
        throw new Error("Method not implemented.");
    }
    async symlink() {
        throw new Error("Method not implemented.");
    }
}