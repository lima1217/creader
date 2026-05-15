export function createOnceCommitter<T>(commit: (value: T) => void) {
  let committed = false;

  return (value: T) => {
    if (committed) return false;
    committed = true;
    commit(value);
    return true;
  };
}
