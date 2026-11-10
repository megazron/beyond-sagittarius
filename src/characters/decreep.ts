/**
 * The de-creep pass on the crew, behind a switch while the owner reviews it (?decreep=1): eyes that look alive
 * (highlight, depth, lid shadow, vergence, irregular blinks, relaxed lids), a face that is never dead-neutral,
 * warmer skin. One flag so "before" and "after" come from the same build.
 */
export const DECREEP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('decreep');
