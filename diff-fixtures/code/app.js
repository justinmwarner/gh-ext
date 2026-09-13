export function summarize(files) {
  const total = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  return `${files.length} files, +${total}`;
}

export const NOISE = [/\.lock$/, /^dist\//, /\.generated\./];
