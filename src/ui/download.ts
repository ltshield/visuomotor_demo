/**
 * download.ts — save text as a file from the browser, with no server involved.
 * The content is turned into an in-memory Blob and offered through a temporary
 * link, so the data never leaves the participant's computer.
 *
 * Key export: `downloadText`.
 */

export function downloadText(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the memory.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
