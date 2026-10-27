// One page, two windows: the list (default) and the quick-add bar (?view=quickadd).
const view = new URLSearchParams(location.search).get('view');
if (view === 'quickadd') import('./quickadd.js');
else import('./app.js');
