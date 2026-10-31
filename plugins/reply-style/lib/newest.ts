// Which reply block is the newest: only it animates, as BB spins the icon on the newest reply alone.
// Blocks are drawn first in the order they appear, so the last id seen for the first time is the newest.

export type NewestTracker = {
  /** Records a drawn block; `isNewest` says whether it may animate, `moved` that an older block must redraw still. */
  see: (id: string) => { isNewest: boolean; moved: boolean };
};

export function createNewestTracker(): NewestTracker {
  const seen = new Set<string>();
  let newest: string | undefined;
  return {
    see(id) {
      if (seen.has(id)) return { isNewest: id === newest, moved: false };
      seen.add(id);
      const moved = newest !== undefined;
      newest = id;
      return { isNewest: true, moved };
    },
  };
}
