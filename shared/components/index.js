/* Sprint 5.5 Foundation Freeze: presentation boundaries.
 * Components are intentionally adapter-shaped until the legacy runtime is
 * migrated. They do not own state and do not alter existing markup.
 */
(function (global) {
  const component = name => Object.freeze({
    name,
    mount(target, markup = "") {
      if (!target) return false;
      target.replaceChildren();
      if (markup) target.insertAdjacentHTML("afterbegin", markup);
      return true;
    },
    update(target, markup = "") {
      return this.mount(target, markup);
    }
  });
  global.ZhugeComponents = Object.freeze({
    Sidebar: component("Sidebar"),
    Header: component("Header"),
    Summary: component("Summary"),
    Calendar: component("Calendar"),
    TaskList: component("TaskList"),
    KnowledgePanel: component("KnowledgePanel"),
    AssistantPanel: component("AssistantPanel"),
    ControlCenter: component("ControlCenter")
  });
})(window);
