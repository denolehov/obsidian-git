import { describe, expect, it } from "vitest";
import {
    between,
    formatMinutes,
    getDisplayPath,
    splitRemoteBranch,
} from "./utils";

describe("between", () => {
    it("should returns true if the middle number is between the two numbers", () => {
        expect(between(-4, -3, -1)).toBe(true);
        expect(between(-3, -1, 4)).toBe(true);
        expect(between(-3, 3, 4)).toBe(true);
        expect(between(3, 4, 5)).toBe(true);
    });
    it("should returns true if all three numbers are the same", () => {
        expect(between(-2, -2, -2)).toBe(true);
        expect(between(0, 0, 0)).toBe(true);
        expect(between(3, 3, 3)).toBe(true);
    });
});

describe("splitRemoteBranch", () => {
    it("should returns undefined as branch if the input only contains remote", () => {
        expect(splitRemoteBranch("origin")).toEqual(["origin", undefined]);
    });
    it("should split remote branch into remote and branches", () => {
        expect(splitRemoteBranch("origin/master")).toEqual([
            "origin",
            "master",
        ]);
        expect(splitRemoteBranch("origin/feature/branch")).toEqual([
            "origin",
            "feature/branch",
        ]);
        expect(splitRemoteBranch("origin/feature/branch/nested")).toEqual([
            "origin",
            "feature/branch/nested",
        ]);
    });
});

describe("getDisplayPath", () => {
    it('should return given path if it ends with "/"', () => {
        expect(getDisplayPath("path/to/")).toBe("path/to/");
    });
});

describe("formatMinutes", () => {
    it('should return "1 minute" if the input is 1', () => {
        expect(formatMinutes(1)).toBe("1 minute");
    });
    it('should return "X minutes" if the input is greater than 1', () => {
        expect(formatMinutes(2)).toBe("2 minutes");
        expect(formatMinutes(3)).toBe("3 minutes");
        expect(formatMinutes(4)).toBe("4 minutes");
    });
});
