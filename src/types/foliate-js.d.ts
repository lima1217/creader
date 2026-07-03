declare module 'foliate-js/view.js' {
  export class ResponseError extends Error {}
  export class NotFoundError extends Error {}
  export class UnsupportedTypeError extends Error {}
  export function makeBook(file: File | Blob | string | unknown): Promise<unknown>;
}
