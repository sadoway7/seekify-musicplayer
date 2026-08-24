const App = {
  async init() {
    Player.init();

    Player.onStateChange = () => {
      UI.updateMiniPlayer();
      UI.updateNowPlaying();
    };

    Player.onTimeUpdate = () => {
      UI.updateSeekBar();
      UI.updateMiniPlayer();
    };

    Player.onTrackChange = async (track) => {
      if (typeof Visualizer !== 'undefined') Visualizer.onTrackChange(track);
      UI.updateMiniPlayer();
      UI.updateNowPlaying();
      UI._renderQueue();
      UI.updateTrackHighlights();
      if (track && !Store.isGuest) {
        try {
          await Api.addRecent(track.id);
          await Store.refreshRecent();
        } catch (err) {}
      }
      if (track) Player.prewarmTranscode(track);
    };

    Player.onQueueChange = () => {
      UI.updateQueueIfVisible();
      UI.updateNowPlaying();
      UI.updateTrackHighlights();
    };

    Player.onVolumeChange = () => {
      UI._updateVolumeBar();
    };

    UI.init();

    Visualizer.init();

    Keyboard.init();

    ReviewUI.init();

    // Skeleton first so the dark shell paints immediately; the setup probe
    // is one round trip and only redirects first-run installs.
    UI.homeSkeleton();

    try {
      const st = await Api.getSetupStatus();
      if (st && st.needsSetup) { UI.showSetupScreen(); return; }
    } catch (e) {}

    const storeLoaded = await Store.init();
    if (!storeLoaded) return;

    // Surface session expiry: api.js dispatches 'auth-required' on any 401
    // (except the login/me/setup/library probes). Without this listener every
    // personal action silently fails after a session expires and only a full
    // reload recovers.
    window.addEventListener('auth-required', () => {
      if (typeof UI !== 'undefined' && UI.showLoginScreen) UI.showLoginScreen();
    });

    if (window.Visualizer) Visualizer.applyServerDefault();

    // URL-based routing
    const path = window.location.pathname;
    if (path === '/settings' || path === '/settings/') {
      Store.currentView = 'settings';
    }

    try {
      UI.renderPage();
    } catch (e) {
      console.error('renderPage error:', e);
      UI.els.content.innerHTML = '<div style="padding:40px;text-align:center;color:#ff6b6b"><div style="font-size:16px;font-weight:600">Error loading page</div><div style="font-size:12px;margin-top:8px;color:#aaa">' + (e.message || e) + '</div></div>';
    }
    UI.updateMiniPlayer();

    UI.renderUserState();

    // Deep link: ?play=TRACK_ID
    const params = new URLSearchParams(window.location.search);
    const playId = params.get('play');
    const sharedQueueId = params.get('q');

    if (sharedQueueId) {
      try {
        const data = await Api.getSharedQueue(sharedQueueId);
        const queueTracks = (data.trackIds || []).map(id => Store.getTrack(id)).filter(Boolean);
        if (queueTracks.length > 0) {
          Player.play(queueTracks[0], queueTracks, { type: 'shared', name: 'Shared Queue' });
          UI.showNowPlaying();
        }
      } catch (e) {}
    } else if (playId) {
      const track = Store.getTrack(playId);
      if (track) {
        // Prime the queue only — no direct audio.src poke. The first tap of
        // play routes through togglePlay → _loadAndPlay, arming the load
        // watchdog instead of bypassing it.
        Player.queue = [track];
        Player.currentIndex = 0;
        Player.playing = false;
        if (Player.onTrackChange) Player.onTrackChange(track);
        if (Player.onStateChange) Player.onStateChange();
        UI.showNowPlaying();
        UI.showToast('Tap play to start listening');
      }
    }

    // Deep link: ?artist=NAME or ?album=ID
    const artistName = params.get('artist');
    const albumId = params.get('album');
    const playlistId = params.get('playlist');
    if (artistName) {
      UI.navigateTo('artist', { artistName });
    } else if (albumId) {
      UI.navigateTo('album', { albumId });
    } else if (playlistId) {
      const playlist = Store.getPlaylist(playlistId);
      if (playlist && playlist.trackIds.length > 0) {
        const tracks = playlist.trackIds.map(id => Store.getTrack(id)).filter(Boolean);
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'playlist', name: playlist.name });
          UI.showNowPlaying();
        }
      } else {
        UI.navigateTo('playlist', { playlistId });
      }
    }

    if (sharedQueueId || playId || artistName || albumId || playlistId) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    this._startLibraryPoll();
  },

  _startLibraryPoll() {
    let lastVersion = null;
    let pendingVersion = null;
    let stableCount = 0;
    const poll = async () => {
      const stats = await Api.getStats();
      if (!stats) { setTimeout(poll, 15000); return; }
      if (lastVersion === null) lastVersion = stats.version;
      const empty = !Store.library.tracks || Store.library.tracks.length === 0;
      let refresh = false;
      if (empty && stats.tracks > 0 && pendingVersion === null) {
        // Rescue: local Store is empty but the server has tracks (missed
        // bump on first boot) — refresh immediately.
        refresh = true;
      } else if (stats.version !== lastVersion) {
        // Debounce: a rip session or scan bumps the version per file, and
        // refreshing per bump means a full library refetch + home re-render
        // (and, historically, a cover reload) per track. Wait one stable
        // poll cycle, then fetch once.
        stableCount = 0;
        if (pendingVersion === stats.version) refresh = true;
        else pendingVersion = stats.version;
      }
      if (refresh) {
        lastVersion = stats.version;
        pendingVersion = null;
        stableCount = 0;
        await Store.refreshLibrary();
        if (Store.currentView === 'home') {
          // Avoid blowing away an in-progress home search on every background
          // poll re-render. If the search bar is focused, keep the DOM and
          // only refresh track highlights.
          const sb = document.querySelector('#home-search-bar .search-input');
          if (!sb || document.activeElement !== sb) {
            UI.renderPage();
          } else {
            UI.updateTrackHighlights();
          }
        } else {
          UI.updateTrackHighlights();
        }
      } else {
        stableCount++;
      }
      const stillEmpty = !Store.library.tracks || Store.library.tracks.length === 0;
      // Stay responsive while the library is changing, then keep a cheap idle
      // poll alive so downloads and external file changes appear later too.
      const nextDelay = stillEmpty || stableCount < 3 ? 5000 : 30000;
      setTimeout(poll, nextDelay);
    };
    setTimeout(poll, 3000);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
