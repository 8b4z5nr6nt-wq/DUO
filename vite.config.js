import { defineConfig } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "version-offline-cache",
      writeBundle(options, bundle) {
        const hash = createHash("sha256");
        for (const name of Object.keys(bundle).sort()) {
          const entry = bundle[name];
          hash.update(name);
          hash.update(
            entry.type === "chunk" ? entry.code : String(entry.source),
          );
        }
        const file = `${options.dir}/sw.js`;
        for (const asset of [
          "sw.js",
          "manifest.webmanifest",
          "icon-192.png",
          "icon-512.png",
        ]) {
          hash.update(asset);
          hash.update(readFileSync(`${options.dir}/${asset}`));
        }
        writeFileSync(
          file,
          readFileSync(file, "utf8").replace(
            "duo-shell-v1",
            `duo-shell-${hash.digest("hex").slice(0, 16)}`,
          ),
        );
      },
    },
  ],
});
