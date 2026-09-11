/** Display metadata must fit Task.title even when the instruction is a long document. */
export function boundedTaskTitle(title: string | null): string | null {
  if (title === null || title.length <= 200) return title;
  // Avoid cutting a UTF-16 surrogate pair. The original instruction stays in input.
  return title.slice(0, 199).replace(/[\uD800-\uDBFF]$/, '') + '…';
}
