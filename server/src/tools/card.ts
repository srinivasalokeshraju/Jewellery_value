// A card is data: fixed words and typed pointers into a tool's structuredContent. It holds no figure and
// no function, so the view that draws it has no place to compute one. The compiler checks every pointer
// against the tool's output type.

type Join<K extends string, Rest extends string> = Rest extends "" ? K : `${K}.${Rest}`;
type OptionalKeys<T> = { [K in keyof T & string]-?: {} extends Pick<T, K> ? K : never }[keyof T & string];
type RequiredKeys<T> = Exclude<keyof T & string, OptionalKeys<T>>;

/** Dot paths from T to a `Leaf`, through objects only. A path never enters an array; `chips` and `table` do that. */
type PathTo<T, Leaf> = T extends Leaf
  ? ""
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? { [K in keyof T & string]-?: Join<K, PathTo<NonNullable<T[K]>, Leaf>> }[keyof T & string]
      : never;

/** The same, but only through fields the output always has. */
type SurePathTo<T, Leaf> = T extends Leaf
  ? ""
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? { [K in RequiredKeys<T>]: Join<K, SurePathTo<T[K], Leaf>> }[RequiredKeys<T>]
      : never;

type Inputs<T> = T extends { inputs: infer I } ? I : never;

/**
 * What a card may point at: any string leaf, plus a number the person typed, echoed under `inputs`.
 * A computed number such as `rates.spot.age_seconds` is not reachable, so nobody can turn it into "3 minutes" in the view.
 */
export type SurePath<T> = SurePathTo<T, string> | `inputs.${SurePathTo<Inputs<T>, number>}`;
export type AnyPath<T> = PathTo<T, string> | `inputs.${PathTo<Inputs<T>, number>}`;
type ListPath<T, Item> = PathTo<T, readonly Item[]>;
type ItemAt<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? ItemAt<NonNullable<T[K]>, Rest>
    : never
  : P extends keyof T
    ? NonNullable<T[P]> extends readonly (infer Item)[]
      ? Item
      : never
    : never;

/** A pointer into structuredContent. The view prints the value found there, unchanged. */
export interface At<P extends string> {
  readonly at: P;
}

export function at<P extends string>(path: P): At<P> {
  return { at: path };
}

/** A run of text: fixed words and pointers, joined in order. Joining is the only operation. */
type Text<P extends string> = readonly (string | At<P>)[];

export type Block<T> =
  /** The one big figure of the card. */
  | { kind: "headline"; label: string; text: Text<SurePath<T>> }
  /** A label and a value. Every pointer must reach a field the output always has. */
  | { kind: "row"; label: string; text: Text<SurePath<T>> }
  /** A row left out whole when any pointer finds nothing. For optional output such as `local_estimate`. */
  | { kind: "row_if_present"; label: string; text: Text<AnyPath<T>> }
  /** Small print, left out when a pointer finds nothing. */
  | { kind: "note"; text: Text<AnyPath<T>> }
  /** A list of short strings, such as purity marks. */
  | { kind: "chips"; label: string; each: ListPath<T, string> }
  /** One table row per array item. Each column points at a string field of the item. */
  | TableOf<T>;

type TableOf<T> = {
  [P in ListPath<T, object>]: { kind: "table"; each: P; columns: readonly { label: string; at: SurePathTo<ItemAt<T, P>, string> }[] };
}[ListPath<T, object>];

/**
 * One tool's card. `T` is the tool's output type.
 * Warnings and errors are not in the template. The view prints every warning and every error the same way, so a template cannot leave one out.
 */
export interface CardTemplate<T> {
  title: string;
  blocks: readonly Block<T>[];
}

/**
 * The template as it travels inside the HTML document: plain JSON with the output type forgotten.
 * The view reads it back through `parseTemplate`, so no cast joins the two types.
 * (Assigning CardTemplate<T> to this type directly overflows tsc's depth limit.)
 */
export interface WireTemplate {
  title: string;
  blocks: readonly WireBlock[];
}

export type WireText = readonly (string | { readonly at: string })[];

export type WireBlock =
  | { kind: "headline" | "row" | "row_if_present"; label: string; text: WireText }
  | { kind: "note"; text: WireText }
  | { kind: "chips"; label: string; each: string }
  | { kind: "table"; each: string; columns: readonly { label: string; at: string }[] };
