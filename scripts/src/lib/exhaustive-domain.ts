// Compile-time exhaustiveness for a hand-written candidate-value tuple.
//
// `allOf<Union>()(["a", "b"])` accepts the tuple only when EVERY member of `Union` appears
// in it, so adding a member to the union without adding it to the tuple is a type error
// rather than a silently smaller enumeration. (Extra values — the malformed sentinels a
// raw sweep needs — are the caller's to add elsewhere; this helper is for the normalized
// space, where the tuple must be exactly the field's own type.)
export const allOf =
  <U>() =>
  <const T extends readonly U[]>(tuple: T & ([U] extends [T[number]] ? unknown : { missingMembers: Exclude<U, T[number]> })): T =>
    tuple;
