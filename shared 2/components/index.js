/* Shared presentation registry.
 * Golden Master owns the empty framework composition; consumers provide
 * adapters, normalized data, and domain-owned interaction handlers.
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
    GoldenMaster: component("GoldenMaster"),
    KnowledgePanel: component("KnowledgePanel"),
    AssistantPanel: component("AssistantPanel"),
    ControlCenter: component("ControlCenter")
  });
})(window);
