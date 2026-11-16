/** A paid candidate may be reused only while the complete saved native source
 * still has exactly the baseline bytes. Reopen can create a new revision with
 * identical bytes; any actual pixel, layer, mask or selection change differs. */
export function imageBaselineMatches(source,job){
 const baseline=job?.studio?.source;
 return !!source&&!!baseline&&source.id===baseline.sourceId&&typeof source.revision==='string'&&source.sourceHash===baseline.sourceHash;
}
