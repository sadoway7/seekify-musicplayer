// ============================================
// ui-home.js — extracted from ui.js
// ============================================
Object.assign(UI, {

  homeSkeleton() {
    let html = '<div class="skeleton-home">';
    html += '<div class="skeleton-search"></div>';
    for (let s = 0; s < 3; s++) {
      html += '<div class="skeleton-section">';
      html += '<div class="skeleton-section-title"></div>';
      if (s === 0) {
        html += '<div class="skeleton-grid">';
        for (let i = 0; i < 6; i++) html += '<div class="skeleton-grid-item"></div>';
        html += '</div>';
      } else {
        html += '<div class="skeleton-row">';
        for (let i = 0; i < 5; i++) {
          html += '<div class="skeleton-card">'
            + '<div class="skeleton-card-art"></div>'
            + '<div class="skeleton-card-line"></div>'
            + '<div class="skeleton-card-line"></div>'
            + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    this.els.content.innerHTML = html;
  },

  renderHome() {
    this._viewTrackList = [];
    this._renderHomeContent();

    let homeRenderPending = false;
    const scheduleHomeRender = () => {
      if (!homeRenderPending) {
        homeRenderPending = true;
        requestAnimationFrame(() => {
          homeRenderPending = false;
          if (Store.currentView === 'home') this._renderHomeContent();
        });
      }
    };

    Store.refreshLibrary().then(scheduleHomeRender);
    if (!Store.isGuest) {
      Store.refreshRecent().then(scheduleHomeRender);
    }
    if (Store.isAdmin) {
      Api.getReviewCounts().then(counts => {
        Store.reviewCounts = counts;
        scheduleHomeRender();
      }).catch(() => {});
    }
  },

  _renderHomeContent() {
    let html = '';

    html += '<div class="home-top-row">'
      + '<div class="home-menu-wrap" id="home-menu-wrap">'
      + '<button class="home-menu-btn" id="home-menu-btn" aria-label="Menu">' + Icons.circle() + '</button>'
      + '<div class="home-menu-dropdown" id="home-menu-dropdown">'
      + '<div class="home-menu-label">Options</div>'
      + '<div class="home-menu-item" data-action="homepage-layout">' + Icons.grid() + '<span>Home Layout</span></div>'
      + (Store.isGuest ? '' : '<div class="home-menu-divider"></div>'
        + '<div class="home-menu-item" data-action="my-account">' + Icons.person() + '<span>My Account</span></div>'
        + (Store.isAdmin ? '<div class="home-menu-item" data-action="settings">' + Icons.settings() + '<span>Settings</span></div>' : ''))
      + '<div class="home-menu-divider"></div>'
      + (Store.isGuest
          ? '<div class="home-menu-item" data-action="login">' + Icons.circle() + '<span>Log in</span></div>'
            + (Store.registrationMode !== 'off' ? '<div class="home-menu-item" data-action="register">' + Icons.plus() + '<span>Register</span></div>' : '')
          : '<div class="home-menu-item" data-action="logout">' + Icons.circle() + '<span>Log out (' + (Store.user.username || '') + ')</span></div>')
      + '</div>'
      + '</div>'
      + '<div class="home-search-bar" id="home-search-bar">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input" type="search" enterkeyhint="search" placeholder="Search library...">'
      + '</div>'
      + '</div>';

    const layout = Store.getHomeLayout();
    const sectionRenderers = {
      'recent': () => this._homeRecent(),
      'artists': () => this._homeArtists(),
      'albums': () => this._homeAlbums(),
      'new-songs': () => this._homeNewSongs(),
      'playlists': () => this._homePlaylists(),
      'needs-review': () => this._homeNeedsReview(),
      'favorites': () => this._homeFavorites()
    };

    const sections = [];
    layout.forEach(s => {
      if (!s.enabled) return;
      const renderer = sectionRenderers[s.id];
      if (!renderer) return;
      const rendered = renderer();
      if (rendered) sections.push(rendered);
    });

    html += sections.join('');

    if (Store.library.tracks.length === 0) {
      html += this._emptyState('No music yet', 'Add music files and rescan to get started', Icons.music());
    }

    this.els.content.innerHTML = html;

    this._bindHomeEvents();
  },

  _homeRecent() {
    if (Store.isGuest) {
      const reg = Store.registrationMode && Store.registrationMode !== 'off';
      let cta = '<div style="position:relative;margin-top:24px;overflow:hidden;background:var(--l1);min-height:144px;display:flex;align-items:center">';
      // Accent glow tints the banner backdrop.
      cta += '<div style="position:absolute;inset:0;background:radial-gradient(120% 160% at 6% 35%, rgba(212,240,64,.13), transparent 55%);pointer-events:none"></div>';
      // Logo as a large faded tilted backdrop on the right; screen blend drops the icon's black bg.
      cta += '<img src="/icon.png" alt="" aria-hidden="true" style="position:absolute;right:-26px;top:50%;transform:translateY(-50%) rotate(-15deg);width:232px;height:232px;opacity:.30;mix-blend-mode:screen;pointer-events:none">';
      // Content stacks left (block, not a flex row) so the capsule never gets
      // pushed over the logo on the right.
      cta += '<div style="position:relative;z-index:1;padding:24px 28px;width:100%">';
      // Wordmark — italic, slanted, hard layered drop shadow = sticker/bomb vibe.
      cta += '<div style="display:inline-block;font-style:italic;font-weight:800;font-size:42px;line-height:.95;letter-spacing:-0.025em;text-shadow:2px 2px 0 rgba(0,0,0,.55),4px 4px 0 rgba(0,0,0,.3);transform:rotate(-2deg);transform-origin:left center;margin-bottom:12px"><span style="color:var(--accent)">Seek</span><span style="color:var(--text-primary)">ify</span></div>';
      cta += '<div style="font-size:15px;line-height:1.45;color:var(--text-secondary);max-width:360px;margin-bottom:18px">Log in to track your listening, save favorites, and build playlists.</div>';
      // Integrated capsule action bar — buttons share one shell, no individual borders.
      cta += '<div style="display:inline-flex;align-items:stretch;background:var(--bg);border-radius:999px;padding:4px;box-shadow:var(--shadow-deep)">';
      cta += '<button id="home-cta-login" style="padding:11px 26px;border:none;border-radius:999px;background:var(--accent);color:var(--bg);font-family:var(--ff);font-size:14px;font-weight:700;cursor:pointer">Log in</button>';
      if (reg) {
        cta += '<button id="home-cta-register" style="padding:11px 26px;border:none;border-radius:999px;background:transparent;color:var(--text-primary);font-family:var(--ff);font-size:14px;font-weight:600;cursor:pointer">Create account</button>';
      }
      cta += '</div></div></div>';
      return cta;
    }
    const recentTracks = Store.recent.map(id => Store.getTrack(id)).filter(Boolean);
    const currentTrack = Player.getCurrentTrack();

    const recentCards = [];
    const seenTracks = new Set();
    recentTracks.forEach(t => {
      if (!seenTracks.has(t.id)) {
        seenTracks.add(t.id);
        recentCards.push({ type: 'track', name: this._trackTitle(t), id: t.id, albumID: t.albumID });
      }
    });

    if (recentCards.length === 0 && !currentTrack) return '';

    let html = '';
    html += '<div class="quick-play-grid" style="margin-top:24px">';

    html += '<div class="quick-play-card quick-play-card-shuffle" data-action="shuffle-all">'
      + '<div class="quick-play-art" style="background:linear-gradient(135deg, #ffffff, #f5f5f5);display:flex;align-items:center;justify-content:center;box-shadow:inset 6px 6px 8px rgba(255,255,255,0.75), inset -8px -8px 12px rgba(0,0,0,0.4), inset 0 0 18px rgba(0,0,0,0.15), 0 8px 16px rgba(0,0,0,0.5)">'
      + '<svg viewBox="0 0 100 100" width="100%" height="100%">'
      + '<circle cx="25" cy="25" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="75" cy="25" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="50" cy="50" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="25" cy="75" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="75" cy="75" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '</svg>'
      + '<div style="position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;overflow:hidden"><span style="font-family:Arial Black,Gadget,sans-serif;font-size:clamp(14px, 4vw, 28px);font-weight:900;color:rgba(0,0,0,0.9);letter-spacing:-0.06em;display:block;white-space:nowrap;filter:drop-shadow(0 0 4px rgba(255,255,255,1)) drop-shadow(0 0 10px rgba(255,255,255,0.9)) drop-shadow(0 0 20px rgba(255,255,255,0.7)) drop-shadow(0 0 40px rgba(255,255,255,0.5)) drop-shadow(0 0 60px rgba(255,255,255,0.3));display:none">SHUFFLED</span></div>'
      + '</div>'
      + '</div>';

    const cols = window.innerWidth >= 1024 ? 5 : window.innerWidth >= 768 ? 4 : 3;
    const maxRecent = window.innerWidth >= 768 ? 12 : 7;
    let addedRecent = 0;
    recentCards.forEach(c => {
      if (addedRecent >= maxRecent) return;
      addedRecent++;
      const isNowPlaying = currentTrack && c.id === currentTrack.id;
      const artInner = '<img src="' + Api.coverUrl(c.albumID || c.id) + '" alt="">';
      const nowPlayingBadge = isNowPlaying
        ? '<div class="quick-play-playing"><div class="eq"><div class="eqb" style="height:5px"></div><div class="eqb" style="height:11px"></div><div class="eqb" style="height:7px"></div></div></div>'
        : '';
      const cardClass = isNowPlaying ? ' quick-play-card-now' : '';
      html += '<div class="quick-play-card quick-play-card-recent' + cardClass + '" data-track-id="' + c.id + '" data-album-id="' + (c.albumID || c.id) + '">'
        + '<div class="quick-play-art">' + artInner + nowPlayingBadge + '</div>'
        + '<div class="quick-play-title">' + this._esc(c.name) + '</div>'
        + '</div>';
    });

    html += '<div class="quick-play-card quick-play-card-all" data-action="shuffle-recent">'
      + '<div class="quick-play-art" style="background:#0d0d0d;display:flex;align-items:center;justify-content:center">'
      + '<div style="position:absolute;bottom:0;left:0;right:0;height:55%;background:linear-gradient(175deg, rgba(220,50,80,0.35), rgba(50,100,220,0.25));pointer-events:none"></div>'
      + '<div style="position:absolute;top:-4px;right:-10px;width:40px;height:40px;background:rgba(220,50,80,0.6);border-radius:50%;pointer-events:none"></div>'
      + '<div style="position:absolute;bottom:28px;left:-6px;width:24px;height:24px;background:rgba(50,140,220,0.5);pointer-events:none"></div>'
      + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden"><span style="font-family:Impact,Haettenschweiler,Arial Black,sans-serif;font-size:100px;font-weight:900;color:rgba(255,255,255,0.35);transform:rotate(-10deg);line-height:0.85;letter-spacing:-0.04em;display:block;margin-top:-8px;-webkit-text-stroke:1px rgba(255,255,255,0.08)">100</span></div></div>'
      + '<div class="quick-play-title" style="background:none;padding-top:38px;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.7);line-height:1.3;white-space:normal">Recently<br>Added</div>'
      + '</div>';

    html += '</div>';
    return html;
  },

  _homeArtists() {
    const namedArtists = Store.library.artists.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    const artistLimit = window.innerWidth >= 768 ? 10 : 6;
    const newArtists = namedArtists.sort((a, b) => this._stableHash(a.name) - this._stableHash(b.name)).slice(0, artistLimit);
    if (newArtists.length === 0) return '';
    let html = '<div class="mega-title"><span>Artists</span></div>';
    html += '<div class="scroll-row artist-row">';
    newArtists.forEach(a => {
      html += '<div class="quick-play-card-inline artist-pill" data-type="artist" data-id="' + this._esc(a.name) + '">'
        + '<div class="quick-play-art"><img src="' + Api.artistArtUrl(a.name) + '" alt=""></div>'
        + '<div class="quick-play-title">' + this._esc(a.name) + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  _homeAlbums() {
    const namedAlbums = Store.library.albums.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    if (namedAlbums.length === 0) return '';
    let html = '<div class="mega-title"><span>Albums</span></div>';
    const shuffledAlbums = namedAlbums.sort((a, b) => this._stableHash(a.name) - this._stableHash(b.name)).slice(0, 15);
    html += '<div class="scroll-row">';
    shuffledAlbums.forEach(a => {
      html += '<div class="card" data-album-id="' + a.id + '">'
        + '<div class="card-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
        + '<div class="card-title">' + this._esc(a.name) + '</div>'
        + '<div class="card-subtitle">' + this._esc(a.artist) + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  _homeNewSongs() {
    const allTracks = Store.library.tracks.slice();
    const sortedNew = allTracks.filter(t => t.artist && t.artist !== '').sort((a, b) => (b.modTime || 0) - (a.modTime || 0));
    const newLimit = this._newSongsLimit || 6;
    const newTracks = sortedNew.slice(0, newLimit);
    if (newTracks.length === 0) return '';
    let html = '<div class="mega-title"><span>New Songs</span></div>';
    html += this.renderTrackList(newTracks, { showArt: true });
    if (sortedNew.length > newLimit) {
      html += '<button class="btn-text show-more-btn" data-action="show-more-new">Show more</button>';
    }
    return html;
  },

  _homePlaylists() {
    if (Store.playlists.length === 0) return '';
    let html = '<div class="mega-title"><span>Playlists</span></div>';
    Store.playlists.slice(0, 4).forEach(p => {
      const pTracks = p.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
      const firstTrack = pTracks[0];
      const artStyle = firstTrack && firstTrack.albumID
        ? 'background-image:url(' + Api.coverUrl(firstTrack.albumID) + ');background-size:cover;background-position:center'
        : 'background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)';
      const artContent = firstTrack && firstTrack.albumID ? '' : Icons.music();
      html += '<div class="list-item" data-type="playlist" data-id="' + p.id + '">'
        + '<div class="list-item-art" style="' + artStyle + '">' + artContent + '</div>'
        + '<div class="list-item-info">'
        + '<div class="list-item-title">' + this._esc(p.name) + '</div>'
        + '<div class="list-item-subtitle">' + pTracks.length + ' tracks</div>'
        + '</div></div>';
    });
    return html;
  },

  _homeNeedsReview() {
    if (!Store.isAdmin) return '';
    const reviewCount = Store.reviewCounts.needs_review || 0;
    if (reviewCount === 0) return '';
    let html = '<div class="home-review-card" data-action="needs-review">'
      + '<div class="home-review-icon">' + Icons.warning() + '</div>'
      + '<div class="home-review-info">'
      + '<div class="home-review-title"><span class="home-review-count">' + reviewCount + '</span> For Review</div>'
      + '</div>'
      + '<div class="home-review-arrow">' + Icons.chevronRight() + '</div>'
      + '</div>';
    return html;
  },

  _homeFavorites() {
    const favTracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
    if (favTracks.length === 0) return '';
    const limit = window.innerWidth >= 768 ? 10 : 5;
    let html = '<div class="mega-title"><span>Favorites</span></div>';
    html += '<div class="home-fav-grid" data-home-section="favorites">';
    html += this.renderTrackList(favTracks.slice(0, limit), { showArt: true });
    html += '</div>';
    return html;
  },

  _bindHomeEvents() {
    const homeSearch = document.getElementById('home-search-bar');
    if (homeSearch) {
      homeSearch.addEventListener('click', () => {
        Store.currentView = 'search';
        Store.viewData = {};
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        const searchTab = document.querySelector('[data-tab="search"]');
        if (searchTab) searchTab.classList.add('active');
        this.renderSearch();
        const input = this.els.content.querySelector('.search-input');
        if (input) input.focus();
      });
      const searchInput = homeSearch.querySelector('.search-input');
      if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const q = searchInput.value.trim();
            if (!q) return;
            Store.currentView = 'search';
            Store.viewData = {};
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            const searchTab = document.querySelector('[data-tab="search"]');
            if (searchTab) searchTab.classList.add('active');
            this.renderSearch();
            const input = this.els.content.querySelector('.search-input');
            if (input) { input.value = q; input.dispatchEvent(new Event('input')); }
          }
        });
      }
    }

    const menuBtn = document.getElementById('home-menu-btn');
    const menuDropdown = document.getElementById('home-menu-dropdown');
    if (menuBtn && menuDropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('open');
      });
      document.addEventListener('click', () => {
        menuDropdown.classList.remove('open');
      });
      menuDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.home-menu-item');
        if (!item) return;
        menuDropdown.classList.remove('open');
        const action = item.dataset.action;
        if (action === 'rescan') {
          this._rescanLibrary();
        } else if (action === 'my-account') {
          Store.currentView = 'settings';
          Store.viewData = {};
          this.renderSettings(true);
        } else if (action === 'settings') {
          Store.currentView = 'settings';
          Store.viewData = {};
          document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
          const settingsTab = document.querySelector('[data-tab="settings"]');
          if (settingsTab) settingsTab.classList.add('active');
          this.renderSettings();
        } else if (action === 'homepage-layout') {
          this._openHomepageLayoutModal();
        } else if (action === 'login') {
          this.showLoginScreen();
        } else if (action === 'register') {
          this._showAuthOverlay('register');
        } else if (action === 'logout') {
          this._logout();
        }
      });
    }

    const ctaLogin = document.getElementById('home-cta-login');
    if (ctaLogin) ctaLogin.addEventListener('click', () => this.showLoginScreen());
    const ctaReg = document.getElementById('home-cta-register');
    if (ctaReg) ctaReg.addEventListener('click', () => this._showAuthOverlay('register'));
  },

});
