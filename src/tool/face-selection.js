export function pendingEnhancements(faces, selected) {
  return faces.flatMap((face, index) => (selected[index] && !face.patch ? [index] : []));
}

export function sameSelection(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => Boolean(value) === Boolean(b[index]));
}

// In catalog order, so overlapping faces stack the way the first result did.
export function selectedPatches(faces, selected) {
  return faces.flatMap((face, index) => (selected[index] && face.patch ? [{patch: face.patch, transform: face.transform}] : []));
}
