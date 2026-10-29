export type StoreUpdate<T> = T | ((previous: T) => T);
export type SelectorStore<T> = ReturnType<typeof createSelectorStore<T>>;

/** Immutable snapshots let each view subscribe to just the fields it renders. */
export function createSelectorStore<T>(initial: T) {
    let snapshot = initial;
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        set(update: StoreUpdate<T>) {
            const next = typeof update === 'function' ? (update as (previous: T) => T)(snapshot) : update;
            if (Object.is(next, snapshot)) return;
            snapshot = next;
            listeners.forEach(listener => listener());
        },
    };
}

export type FieldSetters<T> = { [K in keyof T]: (update: StoreUpdate<T[K]>) => void };
export function createFormStore<T extends object>(initial: T) {
    const store = createSelectorStore(initial);
    const setters = Object.fromEntries((Object.keys(initial) as Array<keyof T>).map(key => [key, (update: StoreUpdate<T[typeof key]>) => {
        store.set(previous => {
            const value = typeof update === 'function' ? (update as (previous: T[typeof key]) => T[typeof key])(previous[key]) : update;
            return Object.is(value, previous[key]) ? previous : { ...previous, [key]: value };
        });
    }])) as FieldSetters<T>;
    return { ...store, setters };
}
