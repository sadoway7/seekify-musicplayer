// Desktop-app frame: renders the custom title bar when the SPA runs inside
// the Windows app's window (loaded with ?desktop=1). In normal browsers
// (and phones) nothing changes — no param, no bar, no API calls.
// Window control buttons hit our own server (/api/window/*), which forwards
// to the desktop shell; the drag region is pure CSS (app-region: drag).
(function () {
  if (!/[?&]desktop=1\b/.test(location.search)) return;

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('desktop-frame');

    var bar = document.createElement('div');
    bar.id = 'desktop-titlebar';
    bar.innerHTML =
      '<div class="dt-title"><span>Seekify</span></div>' +
      '<div class="dt-actions">' +
      '<button class="dt-btn dt-min" title="Minimize">&#x2013;</button>' +
      '<button class="dt-btn dt-max" title="Maximize">&#x25A1;</button>' +
      '<button class="dt-btn dt-close" title="Close (stays running in tray)">&#x2715;</button>' +
      '</div>';

    function act(kind) {
      fetch('/api/window/' + kind, { method: 'POST' }).catch(function () {});
    }
    bar.querySelector('.dt-min').addEventListener('click', function () { act('minimize'); });
    bar.querySelector('.dt-max').addEventListener('click', function () { act('maximize'); });
    // Close = hide to tray; the server keeps running. Real exit lives in
    // the tray menu ("Shutdown Server").
    bar.querySelector('.dt-close').addEventListener('click', function () { act('close'); });

    document.body.appendChild(bar);
  });
})();
