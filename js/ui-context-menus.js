// ============================================
// ui-context-menus.js — Context menu + action handling methods
// Extracted from ui.js. Loaded AFTER ui.js.
// ============================================
Object.assign(UI, {

  showContextMenu(options, triggerEl) {
    this.els.contextMenuItems.innerHTML = options.map((opt, i) => {
      if (opt.type === 'divider') return '<div class="modal-divider"></div>';
      if (opt.type === 'label') return '<div class="modal-title">' + this._esc(opt.label) + '</div>';
      return '<div class="modal-option" data-menu-index="' + i + '">'
        + (opt.icon || '') + '<span>' + opt.label + '</span></div>';
    }).join('');
    this._contextMenuActions = options.map(o => o.action);
    this._contextMenuTrigger = triggerEl;
    this.els.contextMenu.classList.remove('hidden');

    this.els.contextMenu.style.background = 'transparent';

    const sheet = this.els.contextMenu.querySelector('.modal-sheet');
    sheet.style.removeProperty('top');
    sheet.style.removeProperty('bottom');
    sheet.style.removeProperty('left');
    sheet.style.removeProperty('right');

    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const menuW = 240;
      sheet.offsetHeight;
      const menuH = sheet.scrollHeight;
      const pad = 8;

      let top = rect.bottom + 4;
      let left = rect.right - menuW;

      if (left < pad) left = rect.left;
      if (left + menuW > vpW - pad) left = vpW - menuW - pad;

      if (top + menuH > vpH - pad) {
        const aboveTop = rect.top - menuH - 4;
        if (aboveTop >= pad) {
          top = aboveTop;
        } else {
          top = Math.max(pad, vpH - menuH - pad);
        }
      }

      sheet.style.top = top + 'px';
      sheet.style.left = left + 'px';
    }
  },

  hideContextMenu() {
    const menu = this.els.contextMenu;
    if (menu.classList.contains('hidden')) return;
    const sheet = menu.querySelector('.modal-sheet');
    if (sheet) sheet.style.animation = 'sheetSlideOutUp 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
    menu.style.animation = 'modalFadeOut 0.2s ease forwards';
    setTimeout(() => {
      menu.classList.add('hidden');
      menu.style.animation = '';
      if (sheet) sheet.style.animation = '';
    }, 200);
    this._contextMenuActions = null;
    this._contextMenuTrigger = null;
  },

  _showArtistContextMenu(artistName, triggerEl) {
    this.showContextMenu([
      { label: 'Play All', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        const tracks = Store.getArtistTracks(artistName);
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'artist', name: artistName });
          this.showNowPlaying();
        }
      }},
      { label: 'Shuffle', icon: Icons.shuffle(), action: () => {
        this.hideContextMenu();
        const tracks = Store.getArtistTracks(artistName).slice().sort(() => Math.random() - 0.5);
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'artist', name: artistName });
          this.showNowPlaying();
        }
      }},
      { type: 'divider' },
      { label: 'Fetch Artist Image', icon: Icons.refresh(), action: async () => {
        this.hideContextMenu();
        this.showToast('Fetching artist image...');
        try {
          const res = await fetch('/api/artist-art-fetch/' + encodeURIComponent(artistName), { method: 'POST' });
          const data = await res.json();
          if (data.fetched) {
            this.showToast('Artist image updated');
            this.renderArtist(artistName);
          } else {
            this.showToast('No image found for this artist');
          }
        } catch (err) {
          this.showToast('Failed to fetch artist image');
        }
      }},
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?artist=' + encodeURIComponent(artistName);
        if (navigator.share) {
          try { await navigator.share({ title: artistName, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }}
    ], triggerEl);
  },

  _showAlbumContextMenu(albumId, triggerEl) {
    const album = Store.getAlbum(albumId);
    if (!album) return;
    const tracks = Store.getAlbumTracks(albumId);
    this.showContextMenu([
      { label: 'Play', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'album', name: album.name, id: albumId });
          this.showNowPlaying();
        }
      }},
      { label: 'Shuffle', icon: Icons.shuffle(), action: () => {
        this.hideContextMenu();
        const shuffled = tracks.slice().sort(() => Math.random() - 0.5);
        if (shuffled.length > 0) {
          Player.play(shuffled[0], shuffled, { type: 'album', name: album.name, id: albumId });
          this.showNowPlaying();
        }
      }},
      { type: 'divider' },
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?album=' + encodeURIComponent(albumId);
        if (navigator.share) {
          try { await navigator.share({ title: album.name, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }}
    ], triggerEl);
  },

  _showPlaylistContextMenu(playlistId, triggerEl) {
    const playlist = Store.getPlaylist(playlistId);
    if (!playlist) return;
    const tracks = playlist.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
    this.showContextMenu([
      { label: 'Play', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'playlist', name: playlist.name, id: playlistId });
          this.showNowPlaying();
        }
      }},
      { label: 'Shuffle', icon: Icons.shuffle(), action: () => {
        this.hideContextMenu();
        const shuffled = tracks.slice().sort(() => Math.random() - 0.5);
        if (shuffled.length > 0) {
          Player.play(shuffled[0], shuffled, { type: 'playlist', name: playlist.name, id: playlistId });
          this.showNowPlaying();
        }
      }},
      { type: 'divider' },
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?playlist=' + encodeURIComponent(playlistId);
        const shareTitle = playlist.name || 'Playlist';
        if (navigator.share) {
          try { await navigator.share({ title: shareTitle, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }},
      { label: 'Rename', icon: Icons.edit(), action: () => {
        this.hideContextMenu();
        const newName = prompt('Playlist name:', playlist.name);
        if (!newName || !newName.trim() || newName.trim() === playlist.name) return;
        Api.updatePlaylist(playlistId, { name: newName.trim() }).then(() => {
          Store.refreshPlaylists().then(() => {
            this.renderPage();
            this.showToast('Playlist renamed');
          });
        }).catch(() => {
          this.showToast('Failed to rename playlist');
        });
      }},
      { label: 'Delete', icon: Icons.trash(), action: async () => {
        this.hideContextMenu();
        if (!confirm('Delete this playlist?')) return;
        try {
          await Api.deletePlaylist(playlistId);
          await Store.refreshPlaylists();
          this.navigateBack();
          this.showToast('Playlist deleted');
        } catch (err) {
          console.error('Delete playlist failed:', err);
          this.showToast('Failed to delete playlist');
        }
      }}
    ], triggerEl);
  },

  _showTrackContextMenu(trackId, triggerEl) {
    const track = Store.getTrack(trackId);
    if (!track) return;
    this.contextTrackId = trackId;
    const isFav = Store.isFavorite(trackId);
    const menuItems = [
      { label: 'Add to Queue', icon: Icons.queue(), action: () => {
        this.hideContextMenu();
        Player.addToQueue(track);
        this.showToast('Added to queue');
      }},
      { label: 'Add to Playlist', icon: Icons.plus(), action: () => {
        this.hideContextMenu();
        this.showPlaylistModal(trackId);
      }},
      ...(Store.isAdmin ? [
        { label: 'Rescan Metadata', icon: Icons.search(), action: async () => {
          this.hideContextMenu();
          this._showRescanModal(trackId);
        }},
        { label: 'Edit Metadata', icon: Icons.edit(), action: () => {
          this.hideContextMenu();
          ReviewUI.showEditMetaModal(trackId);
        }}
      ] : []),
      { type: 'divider' },
      { label: 'Go to Album', icon: Icons.library(), action: () => {
        this.hideContextMenu();
        this.navigateTo('album', { albumId: track.albumID });
      }},
      { label: 'Go to Artist', icon: Icons.music(), action: () => {
        this.hideContextMenu();
        this.navigateTo('artist', { artistName: track.artist });
      }},
      { type: 'divider' },
      { label: 'Save File', icon: Icons.download(), action: () => {
        this.hideContextMenu();
        const ext = track.filePath ? '.' + track.filePath.split('.').pop() : '';
        const a = document.createElement('a');
        a.href = Api.downloadUrl(trackId);
        a.download = (track.artist ? track.artist + ' - ' : '') + (track.title || 'track') + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }},
      { type: 'divider' },
      { label: isFav ? 'Remove from Favorites' : 'Add to Favorites', icon: isFav ? Icons.heartFilled() : Icons.heart(), action: async () => {
        try {
          await Api.toggleFavorite(trackId);
          await Store.refreshFavorites();
          this.hideContextMenu();
          this.renderPage();
          this.updateNowPlaying();
          this.showToast(isFav ? 'Removed from favorites' : 'Added to favorites');
        } catch (err) {
          this.hideContextMenu();
          this.showToast('Failed to update favorites');
        }
      }}
    ];

    // If viewing a playlist, offer "Remove from Playlist"
    if (Store.currentView === 'playlist' && Store.viewData.playlistId) {
      const playlist = Store.getPlaylist(Store.viewData.playlistId);
      if (playlist && playlist.trackIds.includes(trackId)) {
        menuItems.push({ type: 'divider' });
        menuItems.push({ label: 'Remove from Playlist', icon: Icons.trash(), action: async () => {
          this.hideContextMenu();
          try {
            await Api.removeTrackFromPlaylist(Store.viewData.playlistId, trackId);
            await Store.refreshPlaylists();
            this.renderPage();
            this.showToast('Removed from playlist');
          } catch (err) {
            this.showToast('Failed to remove track');
          }
        }});
      }
    }

    this.showContextMenu(menuItems, triggerEl);
  },

  _showQueueItemContextMenu(index, triggerEl) {
    const track = Player.queue[index];
    if (!track) return;
    const menuItems = [
      { label: 'Remove from Queue', icon: Icons.trash(), action: () => {
        this.hideContextMenu();
        this.showConfirm('Remove this track from the queue?', () => {
          Player.removeFromQueue(index);
        });
      }},
      { label: 'Play Next', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        Player.moveToPlayNext(index);
      }},
      { type: 'divider' },
      { label: 'Go to Album', icon: Icons.library(), action: () => {
        this.hideContextMenu();
        this.hideQueue();
        this.navigateTo('album', { albumId: track.albumID });
      }},
      { label: 'Go to Artist', icon: Icons.music(), action: () => {
        this.hideContextMenu();
        this.hideQueue();
        this.navigateTo('artist', { artistName: track.artist });
      }},
      { type: 'divider' },
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?play=' + encodeURIComponent(track.id);
        if (navigator.share) {
          try { await navigator.share({ title: track.title, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }},
      { label: 'Add to Playlist', icon: Icons.plus(), action: () => {
        this.hideContextMenu();
        this.showPlaylistModal(track.id);
      }},
      { type: 'divider' },
      { label: 'Save File', icon: Icons.download(), action: () => {
        this.hideContextMenu();
        const ext = track.filePath ? '.' + track.filePath.split('.').pop() : '';
        const a = document.createElement('a');
        a.href = Api.downloadUrl(track.id);
        a.download = (track.artist ? track.artist + ' - ' : '') + (track.title || 'track') + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }}
    ];

    this.showContextMenu(menuItems, triggerEl);
  },

  async _showRescanModal(trackId) {
    const track = Store.getTrack(trackId);
    if (!track) return;

    const modal = document.getElementById('rescan-modal');
    const list = document.getElementById('rescan-modal-list');
    const title = document.getElementById('rescan-modal-title');
    const searchInput = document.getElementById('rescan-search-input');
    const searchBtn = document.getElementById('rescan-search-btn');

    const initialQuery = [track.artist, track.title].filter(Boolean).join(' - ');
    searchInput.value = initialQuery;
    title.textContent = this._esc(track.title);

    const renderCandidates = (candidates, hasMore, append) => {
      // Merge with already-shown candidates (dedup by recording id-ish key).
      if (append && this._rescanShown) {
        const seen = new Set(this._rescanShown.map(c => c.title + '|' + c.artist));
        candidates = candidates.filter(c => !seen.has(c.title + '|' + c.artist));
        this._rescanShown = this._rescanShown.concat(candidates);
        candidates = this._rescanShown;
      } else {
        this._rescanShown = candidates.slice();
      }

      if (!candidates || candidates.length === 0) {
        list.innerHTML = this._emptyState('No matches found', 'Try a different search', Icons.search());
        return;
      }

      let html = '<div class="rescan-your-track">'
        + '<div class="rescan-label">Your Track</div>'
        + '<div class="rescan-your-title">' + this._esc(track.title) + '</div>'
        + '<div class="rescan-your-artist">' + this._esc(track.artist) + '</div>'
        + '</div>';

      candidates.forEach(c => {
        const pct = Math.round(c.score * 100);
        const cls = pct >= 80 ? 'score-high' : pct >= 50 ? 'score-mid' : 'score-low';
        const art = c.albumId ? '<img src="/api/finder/cover/' + c.albumId + '" alt="" onerror="this.style.display=\'none\'">' : '';
        const coverBadge = c.hasCover ? ' <span style="color:var(--accent);font-size:10px">&#10003; cover</span>' : '';
        const typeBadge = c.releaseType ? ' <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">' + this._esc(c.releaseType) + '</span>' : '';
        html += '<div class="rescan-candidate" data-title="' + this._esc(c.title) + '" data-artist="' + this._esc(c.artist) + '" data-album="' + this._esc(c.album) + '" data-album-id="' + (c.albumId || '') + '">'
          + (art ? '<div class="rescan-candidate-art">' + art + '</div>' : '')
          + '<div class="rescan-candidate-info">'
          + '<div class="rescan-candidate-title">' + this._esc(c.title) + '</div>'
          + '<div class="rescan-candidate-artist">' + this._esc(c.artist) + '</div>'
          + '<div class="rescan-candidate-album">' + this._esc(c.album || '—') + coverBadge + typeBadge + '</div>'
          + '</div>'
          + '<span class="review-score ' + cls + '">' + pct + '%</span>'
          + '</div>';
      });

      if (hasMore) {
        html += '<button class="finder-load-more-btn" id="btn-rescan-find-more" style="margin:16px auto"><span>Find More</span></button>';
      }

      list.innerHTML = html;

      list.querySelectorAll('.rescan-candidate').forEach(el => {
        el.addEventListener('click', async () => {
          const newTitle = el.dataset.title;
          const newArtist = el.dataset.artist;
          const newAlbum = el.dataset.album;
          const newAlbumId = el.dataset.albumId;

          const result = await Api.metadataUpdateTrack(trackId, {
            title: newTitle,
            artist: newArtist,
            album: newAlbum,
            albumArtist: newArtist,
            albumId: newAlbumId
          });

          if (!result) {
            this.showToast('Failed to update metadata');
            return;
          }

          await Store.refreshLibrary();
          this._closeSheetModal(modal);
          this.showToast('Metadata updated');
          this.renderPage();
          if (Player.getCurrentTrack() && Player.getCurrentTrack().id === trackId) {
            const fresh = Store.getTrack(trackId);
            if (fresh) {
              Object.assign(Player.getCurrentTrack(), fresh);
              this.updateNowPlaying();
            }
          }
          ReviewUI.updateForTrack(trackId);
        });
      });

      const findMoreBtn = list.querySelector('#btn-rescan-find-more');
      if (findMoreBtn) {
        findMoreBtn.addEventListener('click', async () => {
          findMoreBtn.disabled = true;
          findMoreBtn.innerHTML = '<div class="progress-bar-track" style="width:80px"><div class="progress-bar-fill" style="animation:progress-pulse 1.8s ease-in-out infinite"></div></div>';
          await doSearch(searchInput.value, true);
        });
      }
    };

    const doSearch = async (query, append = false) => {
      if (!query.trim()) return;
      if (!append) {
        title.textContent = 'Searching...';
        list.innerHTML = '<div class="loading-spinner" style="margin:24px auto"></div>';
        this._rescanOffset = 0;
        this._rescanShown = null;
      }
      try {
        const res = await Api.metadataSearch(query, this._rescanOffset || 0);
        this._rescanOffset = (this._rescanOffset || 0) + (res.candidates ? res.candidates.length : 0);
        title.textContent = this._esc(track.title);
        renderCandidates(res.candidates || [], res.hasMore, append);
      } catch (err) {
        title.textContent = this._esc(track.title);
        list.innerHTML = this._emptyState('Search failed', 'Could not reach MusicBrainz', Icons.xCircle());
      }
    };

    searchBtn.onclick = () => doSearch(searchInput.value);
    searchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(searchInput.value); };

    modal.classList.remove('hidden');
    doSearch(initialQuery);
  },

  _handleAction(action) {
    if (!action) return;
    if (action === 'favorites') {
      this.navigateTo('favorites');
      return;
    }
    if (action === 'all-music') {
      this.navigateTo('all-music');
      return;
    }
    if (action === 'create-playlist') {
      const row = document.querySelector('.list-item[data-action="create-playlist"]');
      if (row) this._showCreatePlaylistInline(row);
      return;
    }
    if (action === 'needs-review') {
      this.navigateTo('needs-review');
      return;
    }
    if (action === 'approve-review-shown') {
      const flags = this._reviewFlags || [];
      Api.reviewBulkApprove(flags).then(() => {
        this._showToast('Approved ' + this._reviewTotal + ' tracks');
        this.navigateTo('needs-review');
      }).catch(() => this._showToast('Approve failed'));
      return;
    }
    if (action === 'delete-review-shown') {
      const flags = this._reviewFlags || [];
      const count = this._reviewTotal;
      this.showConfirm('Delete ' + count + ' shown tracks? This cannot be undone.', async () => {
        try {
          await Api.reviewBulkDelete(flags);
          this._showToast('Deleted ' + count + ' tracks');
          this.navigateTo('needs-review');
        } catch (e) {
          this._showToast('Delete failed');
        }
      });
      return;
    }
    if (action === 'shuffle' || action === 'shuffle-all') {
      let list = (this._viewTrackList && this._viewTrackList.length > 0)
        ? this._viewTrackList.slice()
        : Store.library.tracks.slice();
      if (list.length > 0) {
        const shuffled = list.sort(() => Math.random() - 0.5);
        const capped = shuffled.slice(0, 100);
        Player.shuffle = false;
        const source = (action === 'shuffle-all')
          ? { type: 'all', name: 'All Music' }
          : this._getViewSource();
        Player.play(capped[0], capped, source);
        this.showNowPlaying();
      }
      return;
    }
    if (action === 'shuffle-recent') {
      const sorted = Store.library.tracks.slice().sort((a, b) => (b.modTime || 0) - (a.modTime || 0));
      const recent = sorted.slice(0, 100);
      if (recent.length > 0) {
        for (let i = recent.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [recent[i], recent[j]] = [recent[j], recent[i]];
        }
        Player.play(recent[0], recent, { type: 'recent', name: 'Recently Added' });
        this.showNowPlaying();
      }
      return;
    }
    if (action === 'delete-playlist') {
      const playlistId = Store.viewData.playlistId;
      if (!playlistId) return;
      if (!confirm('Delete this playlist? This cannot be undone.')) return;
      Api.deletePlaylist(playlistId).then(async () => {
        await Store.refreshPlaylists();
        this.navigateBack();
        this.showToast('Playlist deleted');
      }).catch((err) => {
        console.error('Delete playlist failed:', err);
        this.showToast('Failed to delete playlist');
      });
      return;
    }
    if (action === 'share-playlist') {
      const pid = Store.viewData.playlistId || '';
      const playlist = Store.getPlaylist(pid);
      const shareTitle = playlist ? playlist.name : 'Playlist';
      const shareUrl = window.location.origin + '/?playlist=' + encodeURIComponent(pid);
      if (navigator.share) {
        navigator.share({ title: shareTitle + ' — Music Playlist', url: shareUrl }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareUrl).then(() => this.showToast('Link copied')).catch(() => this.showToast('Share not supported'));
      }
      return;
    }
  },

  _showCreatePlaylistInline(row) {
    const form = document.createElement('div');
    form.className = 'list-item';
    form.style.cssText = 'gap:8px;padding:8px 16px;';
    form.innerHTML = '<input type="text" placeholder="Playlist name" style="flex:1;background:var(--l2);border:none;border-radius:8px;padding:8px 12px;color:var(--text-primary);font-size:14px;">'
      + '<button style="background:var(--accent);color:var(--text-primary);border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;">Create</button>';
    row.style.display = 'none';
    row.parentElement.insertBefore(form, row.nextSibling);
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    input.focus();
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        await Api.createPlaylist(name);
        await Store.refreshPlaylists();
        this.renderLibrary();
        this.showToast('Playlist created');
      } catch (err) {
        this.showToast('Failed to create playlist');
      }
    };
    btn.addEventListener('click', create);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
      if (e.key === 'Escape') {
        form.remove();
        row.style.display = '';
      }
    });
  },

});
