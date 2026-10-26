/* 本地 AI 运行时入口（esbuild 打包目标）
 *
 * 打包命令（见 package.json scripts.build:ai-runtime）：
 *   esbuild build/ai-runtime-entry.js --bundle --format=esm --platform=browser \
 *     --outfile=renderer/ai-runtime.js \
 *     --alias:onnxruntime-web/webgpu=./node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs
 *
 * 说明：
 *  - 必须在渲染进程（Chromium）里跑，onnxruntime-web 的 WASM 后端在 Node 下不可用
 *  - ort.wasm.bundle.min.mjs 内联了 wasm 加载器，但仍需外部 .wasm 文件，
 *    故运行时通过 env.backends.onnx.wasm.wasmPaths 指向 ort-wasm-simd-threaded.wasm
 */
export { pipeline, env, AutoTokenizer, TextStreamer, } from '@huggingface/transformers';
