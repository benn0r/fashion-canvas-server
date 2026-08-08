export interface RetryUpload {
  id: string;
  file: Blob;
  fileName: string;
  createdAt: string;
}

const databaseName = "fashion-canvas";
const storeName = "upload-retry-queue";

export function shouldQueueUpload(error: unknown): boolean {
  return error instanceof UploadRequestError ? error.retryable : error instanceof TypeError;
}

export class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

export async function uploadOutfit(file: Blob, fileName: string, token: string | null) {
  const body = new FormData();
  body.set("photo", file, fileName);
  const response = await fetch("/api/outfits", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new UploadRequestError(
      data.error || `Request failed with status ${response.status}`,
      response.status >= 500,
    );
  }
  return data;
}

export async function listRetryUploads(): Promise<RetryUpload[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as RetryUpload[]).sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        ),
      );
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueRetryUpload(file: Blob, fileName: string): Promise<RetryUpload> {
  const item: RetryUpload = {
    id: crypto.randomUUID(),
    file,
    fileName,
    createdAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  await transactionRequest(database, "readwrite", (store) => store.put(item));
  return item;
}

export async function removeRetryUpload(id: string): Promise<void> {
  const database = await openDatabase();
  await transactionRequest(database, "readwrite", (store) => store.delete(id));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionRequest(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
