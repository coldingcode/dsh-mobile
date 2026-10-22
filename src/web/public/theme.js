(function () {
  try {
    var saved = localStorage.getItem('dshm-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch (error) {}
})();
