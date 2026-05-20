export function slugify(text: string) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, "-")          // spaces & underscores → dash
        .replace(/[^\p{L}\p{N}-]+/gu, "") // keep ALL letters (any language) + numbers
        .replace(/--+/g, "-");            // collapse multiple dashes
}