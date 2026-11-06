import { readFile } from "node:fs/promises";
import { prepareImport } from "../src/materials.js";
const paths = process.argv.slice(2);
if (!paths.length) throw Error("検証するJSONファイルを指定してください。");
let items = [];
for (const path of paths) {
  try {
    const result = prepareImport(
      JSON.parse(await readFile(path, "utf8")),
      items,
    );
    items.push(...result.items);
  } catch {
    console.error(
      `${path}: 検証失敗。アプリのローカルプレビューで詳細を確認してください。`,
    );
    process.exit(1);
  }
}
console.log(
  `検証成功: ${paths.length}ファイル、${items.length}問題。教材内容は出力しません。`,
);
