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
      UI.updateMiniPlayer();
      UI.updateNowPlaying();
      UI._renderQueue();
      UI.updateTrackHighlights();
      if (track) {
        try {
          await Api.addRecent(track.id);
          await Store.refreshRecent();
        } catch (err) {}
      }
    };

    Player.onQueueChange = () => {
      UI.updateQueueIfVisible();
    };

    UI.init();

    ReviewUI.init();

    UI.els.content.innerHTML = '<div class="loading-spinner"></div>';

    await Store.init();

    // URL-based routing
    const path = window.location.pathname;
    if (path === '/settings' || path === '/settings/') {
      Store.currentView = 'settings';
    } else if (path === '/ripperv2' || path === '/ripperv2/') {
      Store.currentView = 'ripper2';
    }

    UI.renderPage();
    UI.updateMiniPlayer();

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
        // Load the track but don't auto-play — user taps play
        Player.queue = [track];
        Player.currentIndex = 0;
        Player.audio.src = Api.streamUrl(track.id);
        Player.playing = false;
        if (Player.onTrackChange) Player.onTrackChange(track);
        if (Player.onStateChange) Player.onStateChange();
        UI.showNowPlaying();
      }
    }

    // Deep link: ?artist=NAME or ?album=ID
    const artistName = params.get('artist');
    const albumId = params.get('album');
    const playlistId = params.get('playlist');
    if (playId) {
      const track = Store.getTrack(playId);
      if (track) {
        Player.queue = [track];
        Player.currentIndex = 0;
        Player.audio.src = Api.streamUrl(track.id);
        Player.playing = false;
        if (Player.onTrackChange) Player.onTrackChange(track);
        if (Player.onStateChange) Player.onStateChange();
        UI.showNowPlaying();
      }
    } else if (artistName) {
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
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
