// @ts-check

/**
 * The legacy router and the clean route have separate module graphs. Reloading
 * only when a hash navigation crosses that boundary lets the host select the
 * right graph without coupling either application to the other one's router.
 *
 * @param {{location:{hash:string,reload:()=>void},addEventListener:(type:string,listener:()=>void)=>void}} target
 */
export function installRouteBoundaryReload(target) {
  let wasNew = isNewRoute(target.location.hash);
  let previousHash = target.location.hash;
  target.addEventListener('hashchange', () => {
    const isNew = isNewRoute(target.location.hash);
    if (isNew !== wasNew || (isNew && target.location.hash !== previousHash)) {
      target.location.reload();
    }
    wasNew = isNew;
    previousHash = target.location.hash;
  });
}

/** @param {string} hash */
function isNewRoute(hash) {
  return /^#\/new_dashboard\//.test(hash);
}
