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
      if (track) {
        try {
          await Api.addRecent(track.id);
          await Store.refreshRecent();
        } catch (err) {}
      }
    };

    Player.onQueueChange = () => {
      if (!UI.els.queuePanel.classList.contains('hidden')) {
        UI._renderQueue();
      }
    };

    UI.init();

    UI.els.content.innerHTML = '<div class="loading-spinner"></div>';

    try {
      await Api.scan();
    } catch (err) {}

    await Store.init();
    UI.renderPage();
    UI.updateMiniPlayer();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
