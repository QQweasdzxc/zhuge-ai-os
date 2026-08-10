/* Foundation contract for module selection, recency, and favourites. */
(function (global) {
  const state = { active: "dashboard", recent: [], favourites: [] };

  function select(id) {
    if (!id) return state.active;
    state.active = String(id);
    state.recent = [state.active, ...state.recent.filter(item => item !== state.active)].slice(0, 8);
    return state.active;
  }

  function snapshot() {
    return Object.freeze({ active: state.active, recent: state.recent.slice(), favourites: state.favourites.slice() });
  }

  global.WorkspaceManager = Object.freeze({ select, snapshot });
})(window);
