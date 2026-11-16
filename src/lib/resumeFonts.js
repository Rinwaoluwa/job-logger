// Where the browser loads the résumé typeface (the one the PDF and .docx
// embed) for the preview and HTML export. Absolute, because the preview
// is a srcDoc iframe and the exported .html is opened from disk.
export const RESUME_FONT_BASE = `${window.location.origin}/api/fonts`;
