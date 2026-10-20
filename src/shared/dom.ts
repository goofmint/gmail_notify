/**
 * id で要素を取得し、期待する種類であることを確かめる。
 * 見つからない、または種類が違う場合は id を含むエラーにする（HTML とコードのずれを早く見つけるため）。
 */
export function getElement<T extends HTMLElement>(
  doc: Document,
  id: string,
  type: { new (): T; prototype: T },
): T {
  const element = doc.getElementById(id);
  if (element === null) {
    throw new Error(`要素 #${id} が見つからない`);
  }
  if (!(element instanceof type)) {
    throw new Error(`要素 #${id} の種類が想定と違う: ${element.tagName}`);
  }
  return element;
}
