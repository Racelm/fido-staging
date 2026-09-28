/**
 * Normalise les jointures Supabase (v2) qui peuvent typer une relation to-one
 * comme un tableau. Retourne le premier élément (ou l'objet directement si
 * ce n'est pas un tableau).
 */
export function firstRel<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  if (Array.isArray(v)) return (v[0] as T) ?? null
  return v
}
