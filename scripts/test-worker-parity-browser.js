import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./test-worker-parity-browser.cjs");
