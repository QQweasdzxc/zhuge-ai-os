(function initProcurementTabs(global){
  "use strict";
  function activate(key){
    document.querySelectorAll('[data-procurement-nav]').forEach(btn=>{
      const on=btn.dataset.procurementNav===key;
      btn.classList.toggle('active',on);
      btn.setAttribute('aria-selected',String(on));
    });
    document.querySelectorAll('[data-procurement-panel]').forEach(panel=>{
      panel.hidden=panel.dataset.procurementPanel!==key;
    });
    global.dispatchEvent(new CustomEvent('zhuge:procurement-tab-change',{detail:{key}}));
  }
  document.addEventListener('click',event=>{
    const btn=event.target.closest?.('[data-procurement-nav]');
    if(!btn)return;
    event.preventDefault();
    activate(btn.dataset.procurementNav);
  },true);
  global.ZhugeProcurementTabs={activate};
})(window);
