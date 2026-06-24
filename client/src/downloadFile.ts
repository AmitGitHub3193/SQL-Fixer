export function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.sql') ? fileName : `${fileName}.sql`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
