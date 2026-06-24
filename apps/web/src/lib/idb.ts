/**
 * Минимальная обёртка над IndexedDB (ТЗ §3: IndexedDB как локальный кэш).
 * Один объектный стор key-value на базу данных. Без внешних зависимостей.
 */

export class IdbStore<T> {
	private dbPromise: Promise<IDBDatabase> | null = null;

	constructor(
		private dbName: string,
		private storeName: string
	) {}

	private open(): Promise<IDBDatabase> {
		if (this.dbPromise) return this.dbPromise;
		this.dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(this.dbName, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		return this.dbPromise;
	}

	private async tx<R>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<R> {
		const db = await this.open();
		return new Promise<R>((resolve, reject) => {
			const tx = db.transaction(this.storeName, mode);
			const req = fn(tx.objectStore(this.storeName));
			req.onsuccess = () => resolve(req.result as R);
			req.onerror = () => reject(req.error);
		});
	}

	get(key: string): Promise<T | undefined> {
		return this.tx<T | undefined>('readonly', (s) => s.get(key));
	}

	set(key: string, value: T): Promise<IDBValidKey> {
		return this.tx<IDBValidKey>('readwrite', (s) => s.put(value, key));
	}

	delete(key: string): Promise<undefined> {
		return this.tx<undefined>('readwrite', (s) => s.delete(key));
	}

	keys(): Promise<string[]> {
		return this.tx<string[]>('readonly', (s) => s.getAllKeys() as IDBRequest) as Promise<string[]>;
	}
}
