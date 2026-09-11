/** Keep the UTF-16 budget used by HTML maxlength without splitting a surrogate pair. */
export function truncateText(text: string, maxLength: number): string {
    let end = Math.max(0, Math.trunc(maxLength));
    if (text.length <= end) return text;
    const before = text.charCodeAt(end - 1);
    const after = text.charCodeAt(end);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
    return text.slice(0, end);
}
