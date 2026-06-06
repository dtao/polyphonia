const DB_NAME = "polyphonia";
const DB_VERSION = 2;

export const STEM_STORE = "stems";
export const ASSET_STORE = "assets";
export const DETAIL_PACK_STORE = "detail-packs";

let dbPromise: Promise<IDBDatabase> | null = null;

export function polyphoniaDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STEM_STORE)) {
          database.createObjectStore(STEM_STORE);
        }
        if (!database.objectStoreNames.contains(ASSET_STORE)) {
          database.createObjectStore(ASSET_STORE);
        }
        if (!database.objectStoreNames.contains(DETAIL_PACK_STORE)) {
          database.createObjectStore(DETAIL_PACK_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Polyphonia storage upgrade was blocked by another open tab."));
    });
  }
  return dbPromise;
}

export function databaseRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return polyphoniaDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = action(database.transaction(storeName, mode).objectStore(storeName));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}
