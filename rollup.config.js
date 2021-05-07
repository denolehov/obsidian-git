import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
    input: "src/main.ts",
    output: {
        dir: ".",
        sourcemap: "inline",
        format: "cjs",
        exports: "default",
    },
    external: ["obsidian", "child_process"],
    plugins: [typescript(), nodeResolve({ browser: true }), commonjs()],
};
