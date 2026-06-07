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

    UI.els.content.innerHTML = '<div class="loading-spinner"></div>';

    await Store.init();
    UI.renderPage();
    UI.updateMiniPlayer();

    // Deep link: ?play=TRACK_ID
    const params = new URLSearchParams(window.location.search);
    const playId = params.get('play');
    if (playId) {
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
    if (artistName) {
      UI.navigateTo('artist', { artistName });
    } else if (albumId) {
      UI.navigateTo('album', { albumId });
    }

    // Clean the URL without reloading
    if (playId || artistName || albumId) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
