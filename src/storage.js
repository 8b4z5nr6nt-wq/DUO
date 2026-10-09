import { emptyState } from "./core.js";
let db,
  revision = 0;
export async function openStorage() {
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("duo-personal", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("state");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(Error("別のDUO画面を閉じてから再読み込みしてください。"));
  });
  db.onversionchange = () => db.close();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly"),
      r = tx.objectStore("state").get("current");
    r.onsuccess = () => {
      const value = r.result || emptyState();
      revision = value._revision || 0;
      delete value._revision;
      resolve(value);
    };
    r.onerror = () => reject(r.error);
  });
}
export function saveStorage(state) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction("state", "readwrite");
      const store = tx.objectStore("state");
      let error;
      const req = store.get("current");
      req.onsuccess = () => {
        try {
          if ((req.result?._revision || 0) !== revision) {
            error = Error(
              "別のDUO画面でデータが更新されました。この画面を再読み込みしてからやり直してください。",
            );
            error.name = "ConflictError";
            tx.abort();
            return;
          }
          store.put({ ...state, _revision: revision + 1 }, "current");
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        revision++;
        resolve();
      };
      tx.onabort = () =>
        reject(error || tx.error || Error("保存が中断されました。"));
      tx.onerror = () => reject(error || tx.error);
    } catch (e) {
      reject(e);
    }
  });
}
export function storageMessage(e) {
  if (e?.name === "ConflictError") return e.message;
  return e?.name === "QuotaExceededError"
    ? "端末の保存容量が不足しています。バックアップ後、不要なデータや端末の空き容量を確認してください。保存は完了していません。"
    : `端末への保存に失敗しました。Safariの保存制限・空き容量を確認してください。保存前のデータは保持しています。${e?.message ? "（" + e.message + "）" : ""}`;
}
