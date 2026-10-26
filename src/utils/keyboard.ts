/** IME candidates own their keys, including WebKit's final keyCode 229 event. */
export function isComposingKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
    return event.isComposing || event.keyCode === 229;
}
